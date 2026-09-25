// Model układu: elementy z transformacją, porty w układzie świata, łączenie,
// undo/redo, serializacja, zestawienie części.

import { BY_ID, sampleSegment, segmentLength } from './catalog.js';

const d2r = (d) => (d * Math.PI) / 180;
export const norm = (a) => ((a % 360) + 540) % 360 - 180; // do (-180, 180]

const SNAP_DIST = 0.6;   // mm – porty uznajemy za połączone
const SNAP_ANG = 1.0;    // stopnie
const STORAGE_KEY = 'routelayout.v1';

let nextUid = 1;

export class Layout {
  constructor() {
    this.pieces = [];
    this.board = { w: 2000, h: 1000 };
    this.name = 'Layout';
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this._portCache = null;
  }

  // ---- zdarzenia ----
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = 'change') { this._portCache = null; for (const fn of this.listeners) fn(kind, this); }

  // ---- undo ----
  snapshot() { return JSON.stringify({ pieces: this.pieces, board: this.board, name: this.name }); }
  pushUndo() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack.length = 0; }
  restore(json) {
    const s = JSON.parse(json);
    this.pieces = s.pieces; this.board = s.board; this.name = s.name ?? this.name;
    nextUid = Math.max(nextUid, ...this.pieces.map((p) => p.uid + 1), 1);
    this.emit('change');
  }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); }

  // ---- transformacje ----
  static localToWorld(piece, x, y) {
    const c = Math.cos(d2r(piece.rot)), s = Math.sin(d2r(piece.rot));
    return { x: piece.x + x * c - y * s, y: piece.y + x * s + y * c };
  }
  static worldToLocal(piece, x, y) {
    const c = Math.cos(d2r(piece.rot)), s = Math.sin(d2r(piece.rot));
    const dx = x - piece.x, dy = y - piece.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }
  static def(piece) { return BY_ID[piece.id]; }

  /** Port elementu w układzie świata. */
  static worldPort(piece, idx) {
    const p = BY_ID[piece.id].geo.ports[idx];
    const w = Layout.localToWorld(piece, p.x, p.y);
    return { x: w.x, y: w.y, a: norm(p.a + piece.rot), piece, idx };
  }

  /** Wszystkie porty świata + informacja o połączeniu (cache). */
  ports() {
    if (this._portCache) return this._portCache;
    const all = [];
    for (const piece of this.pieces) {
      const n = BY_ID[piece.id].geo.ports.length;
      for (let i = 0; i < n; i++) all.push({ ...Layout.worldPort(piece, i), mate: null });
    }
    // O(n²) wystarcza dla kilkuset elementów
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.mate) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (b.mate || b.piece === a.piece) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > SNAP_DIST) continue;
        if (Math.abs(norm(a.a - b.a + 180)) > SNAP_ANG) continue;
        a.mate = b; b.mate = a; break;
      }
    }
    this._portCache = all;
    return all;
  }
  openPorts() { return this.ports().filter((p) => !p.mate); }
  portOf(piece, idx) { return this.ports().find((p) => p.piece === piece && p.idx === idx); }

  /** Transformacja, przy której port `entry` nowego elementu pokrywa się z `target` (kierunki przeciwne). */
  static poseFor(articleId, entry, target) {
    const lp = BY_ID[articleId].geo.ports[entry];
    const rot = norm(target.a + 180 - lp.a);
    const c = Math.cos(d2r(rot)), s = Math.sin(d2r(rot));
    return { x: target.x - (lp.x * c - lp.y * s), y: target.y - (lp.x * s + lp.y * c), rot };
  }

  // ---- edycja ----
  add(articleId, pose) {
    this.pushUndo();
    const piece = { uid: nextUid++, id: articleId, x: pose.x, y: pose.y, rot: norm(pose.rot) };
    this.pieces.push(piece);
    this.emit('change');
    return piece;
  }
  attach(articleId, entry, target) { return this.add(articleId, Layout.poseFor(articleId, entry, target)); }
  remove(piece) {
    this.pushUndo();
    this.pieces = this.pieces.filter((p) => p !== piece);
    this.emit('change');
  }
  move(piece, x, y, rot = piece.rot, record = true) {
    if (record) this.pushUndo();
    piece.x = x; piece.y = y; piece.rot = norm(rot);
    this.emit(record ? 'change' : 'drag');
  }
  rotate(piece, deg) { this.move(piece, piece.x, piece.y, piece.rot + deg); }
  clear() { this.pushUndo(); this.pieces = []; this.emit('change'); }
  /** Nowy układ: elementy, nazwa i blat od zera; historia undo wyczyszczona. */
  reset(name) {
    this.pieces = []; this.board = { w: 2000, h: 1000 }; this.name = name;
    this.undoStack.length = 0; this.redoStack.length = 0;
    this.emit('change');
  }
  setBoard(w, h) { this.pushUndo(); this.board = { w, h }; this.emit('change'); }

  /**
   * Szuka otwartego portu innego elementu w pobliżu któregoś z portów `piece`
   * i zwraca pozę dociągniętą (snap) lub null.
   */
  snapPose(piece, radius = 12) {
    const others = this.openPorts().filter((p) => p.piece !== piece);
    const n = BY_ID[piece.id].geo.ports.length;
    let best = null;
    for (let i = 0; i < n; i++) {
      const mine = Layout.worldPort(piece, i);
      for (const o of others) {
        const d = Math.hypot(mine.x - o.x, mine.y - o.y);
        if (d > radius || (best && d >= best.d)) continue;
        // tylko jeśli kąt jest w miarę zgodny (±25°) – inaczej snap "szarpie"
        if (Math.abs(norm(mine.a - o.a + 180)) > 25) continue;
        best = { d, pose: Layout.poseFor(piece.id, i, o) };
      }
    }
    return best ? best.pose : null;
  }

  // ---- geometria świata do rysowania ----
  /** Lista { piece, seg, pts:[[x,y],...] } dla wszystkich segmentów. */
  worldSegments(step = 8) {
    const out = [];
    for (const piece of this.pieces) {
      for (const seg of BY_ID[piece.id].geo.segments) {
        const pts = sampleSegment(seg, step).map(([x, y]) => { const w = Layout.localToWorld(piece, x, y); return [w.x, w.y]; });
        out.push({ piece, seg, pts });
      }
    }
    return out;
  }

  bounds() {
    if (!this.pieces.length) return { minX: 0, minY: 0, maxX: this.board.w, maxY: this.board.h };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.worldSegments(25)) for (const [x, y] of s.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return { minX, minY, maxX, maxY };
  }

  /** Test trafienia: element, którego oś toru leży w promieniu r od (x,y). */
  hitTest(x, y, r = 12) {
    let best = null;
    for (const s of this.worldSegments(6)) {
      for (const [px, py] of s.pts) {
        const d = Math.hypot(px - x, py - y);
        if (d < r && (!best || d < best.d)) best = { d, piece: s.piece };
      }
    }
    return best ? best.piece : null;
  }

  // ---- zestawienie ----
  bom() {
    const counts = new Map();
    for (const p of this.pieces) counts.set(p.id, (counts.get(p.id) || 0) + 1);
    return [...counts.entries()].map(([id, n]) => ({ id, n, def: BY_ID[id] })).sort((a, b) => a.id.localeCompare(b.id));
  }
  totalLength() {
    let L = 0;
    for (const p of this.pieces) for (const s of BY_ID[p.id].geo.segments) L += segmentLength(s);
    return L;
  }

  // ---- (de)serializacja ----
  toJSON() { return { version: 1, name: this.name, board: this.board, pieces: this.pieces.map(({ id, x, y, rot }) => ({ id, x, y, rot })) }; }
  load(obj) {
    if (!obj || !Array.isArray(obj.pieces)) throw new Error('Nieprawidłowy plik układu');
    this.pushUndo();
    this.name = obj.name || 'Layout';
    this.board = obj.board || this.board;
    this.pieces = obj.pieces.filter((p) => BY_ID[p.id]).map((p) => ({ uid: nextUid++, id: p.id, x: +p.x || 0, y: +p.y || 0, rot: norm(+p.rot || 0) }));
    this.emit('change');
  }
  save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON())); } catch { /* prywatny tryb Safari */ } }
  static loadSaved(layout) {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) { layout.load(JSON.parse(s)); layout.undoStack.length = 0; return true; } } catch { /* ignoruj */ }
    return false;
  }
}
