// Model układu: elementy z transformacją, porty w układzie świata, łączenie,
// undo/redo, serializacja, zestawienie części.

import { SpatialHash } from './spatial.js';
import { BY_ID, geoOf, sampleSegment, segmentLength, TURNTABLE_ID } from './catalog.js';
import { SCENERY, sceneryHit } from './scenery.js';

const d2r = (d) => (d * Math.PI) / 180;
export const norm = (a) => ((a % 360) + 540) % 360 - 180; // do (-180, 180]

const SNAP_DIST = 0.6;   // mm – porty uznajemy za połączone
const SNAP_ANG = 1.0;    // stopnie
const SNAP_Z = 3;        // mm – różnica wysokości, przy której porty jeszcze się łączą
const LEVEL_GAP = 30;    // mm – większa przerwa między wysokościami końców = osobny poziom
const RIM_TOL = 14;      // mm – tolerancja dociągania do obrzeża obrotnicy
const STORAGE_KEY = 'routelayout.v1';
export const DEFAULT_BOARD_COLOR = '#5f8f4a';

let nextUid = 1;

export class Layout {
  constructor() {
    this.pieces = [];
    this.scenery = [];
    this.board = { w: 2000, h: 1000, color: DEFAULT_BOARD_COLOR };
    this.name = 'Layout';
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this._portCache = null;
    this._segCache = new Map();   // step -> worldSegments(step); czyszczony razem z portami
  }

  // ---- zdarzenia ----
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = 'change') {
    this._portCache = null; this._segCache.clear();
    // każdy listener osobno: awaria jednego (np. WebGL) nie może przerwać operacji ani pozostałych
    for (const fn of this.listeners) {
      try { fn(kind, this); } catch (err) { console.error('listener', kind, err); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('routelayout:error', { detail: err })); }
    }
  }

  // ---- undo ----
  snapshot() { return JSON.stringify({ pieces: this.pieces, scenery: this.scenery, board: this.board, name: this.name }); }
  pushUndo() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack.length = 0; }
  restore(json) {
    const s = JSON.parse(json);
    this.pieces = s.pieces; this.scenery = s.scenery || []; this.board = s.board; this.name = s.name ?? this.name;
    nextUid = Math.max(nextUid, ...this.pieces.map((p) => p.uid + 1), ...this.scenery.map((p) => p.uid + 1), 1);
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
    const p = geoOf(piece).ports[idx];
    const w = Layout.localToWorld(piece, p.x, p.y);
    return { x: w.x, y: w.y, a: norm(p.a + piece.rot), z: Layout.portZ(piece, idx), piece, idx };
  }
  /** Wysokość portu: port 0 = z, pozostałe = z + dz (obrotnica: wszystkie = z). */
  static portZ(piece, idx) { return (piece.z || 0) + (idx === 0 || BY_ID[piece.id].turntable ? 0 : (piece.dz || 0)); }
  static pieceLength(piece) { const g = geoOf(piece); return g.segments.length ? segmentLength(g.segments[0]) : 0; }

  /** Wszystkie porty świata + informacja o połączeniu (cache). Parowanie przez siatkę przestrzenną: ~O(n). */
  ports() {
    if (this._portCache) return this._portCache;
    const all = [], byPiece = new Map();
    const grid = new SpatialHash(SNAP_DIST * 4);
    for (const piece of this.pieces) {
      const n = geoOf(piece).ports.length, list = [];
      for (let i = 0; i < n; i++) { const port = { ...Layout.worldPort(piece, i), mate: null }; all.push(port); list.push(port); grid.add(port.x, port.y, port); }
      byPiece.set(piece, list);
    }
    for (const a of all) {
      if (a.mate) continue;
      for (const b of grid.near(a.x, a.y)) {
        if (b === a || b.mate || b.piece === a.piece) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > SNAP_DIST) continue;
        if (Math.abs(norm(a.a - b.a + 180)) > SNAP_ANG) continue;
        if (Math.abs(a.z - b.z) > SNAP_Z) continue;
        a.mate = b; b.mate = a; break;
      }
    }
    this._portCache = all;
    this._portsByPiece = byPiece;
    return all;
  }
  openPorts() { return this.ports().filter((p) => !p.mate); }
  /** Porty jednego elementu (indeks = numer portu). */
  portsOf(piece) { this.ports(); return this._portsByPiece.get(piece) || []; }
  portOf(piece, idx) { return this.portsOf(piece)[idx] || null; }

  /** Transformacja, przy której port `entry` nowego elementu pokrywa się z `target` (kierunki przeciwne). */
  static poseFor(articleId, entry, target) {
    const lp = (BY_ID[articleId].dynamic ? geoOf({ id: articleId, r: BY_ID[articleId].r, bridge: 0, angles: [] }) : BY_ID[articleId].geo).ports[entry];
    const rot = norm(target.a + 180 - lp.a);
    const c = Math.cos(d2r(rot)), s = Math.sin(d2r(rot));
    return { x: target.x - (lp.x * c - lp.y * s), y: target.y - (lp.x * s + lp.y * c), rot };
  }

  // ---- edycja ----
  add(articleId, pose) {
    this.pushUndo();
    const piece = { uid: nextUid++, id: articleId, x: pose.x, y: pose.y, rot: norm(pose.rot), z: pose.z || 0, dz: pose.dz || 0 };
    if (BY_ID[articleId].turntable) Object.assign(piece, { r: BY_ID[articleId].r, bridge: 0, angles: [], rot: 0 });
    this.pieces.push(piece);
    this.emit('change');
    return piece;
  }
  /** Dodaje wiele elementów jako jeden krok undo. */
  addMany(list) {
    this.pushUndo();
    const out = list.map((p) => { const piece = { uid: nextUid++, id: p.id, x: p.x, y: p.y, rot: norm(p.rot), z: p.z || 0, dz: p.dz || 0 }; this.pieces.push(piece); return piece; });
    this.emit('change');
    return out;
  }
  /** Dokleja element do portu; dziedziczy wysokość portu i nachylenie elementu, z którego wychodzi. */
  attach(articleId, entry, target) {
    const pose = Layout.poseFor(articleId, entry, target);
    pose.z = target.z || 0;
    const src = target.piece;
    const grade = src && !BY_ID[src.id].turntable && Layout.pieceLength(src) ? (src.dz || 0) / Layout.pieceLength(src) : 0;
    const len = BY_ID[articleId].turntable ? 0 : segmentLength(BY_ID[articleId].geo.segments[0]);
    pose.dz = entry === 0 ? grade * len : -grade * len;
    if (entry !== 0) pose.z = (target.z || 0) - pose.dz;   // wejście "od tyłu": port 0 leży dalej
    return this.add(articleId, pose);
  }
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
  /** Przesunięcie grupy o (dx, dy) – jeden krok undo (record) lub podgląd (drag). */
  moveMany(pieces, dx, dy, record = true) {
    if (record) this.pushUndo();
    for (const p of pieces) { p.x += dx; p.y += dy; }
    this.emit(record ? 'change' : 'drag');
  }
  /** Obrót grupy o deg wokół (cx, cy). */
  rotateMany(pieces, deg, cx, cy) {
    this.pushUndo();
    const c = Math.cos(d2r(deg)), s = Math.sin(d2r(deg));
    for (const p of pieces) {
      const dx = p.x - cx, dy = p.y - cy;
      p.x = cx + dx * c - dy * s; p.y = cy + dx * s + dy * c;
      if (!BY_ID[p.id].turntable) p.rot = norm(p.rot + deg); else p.bridge = norm((p.bridge || 0) + deg);
    }
    this.emit('change');
  }
  removeMany(pieces) {
    const set = new Set(pieces);
    this.pushUndo();
    this.pieces = this.pieces.filter((p) => !set.has(p));
    this.emit('change');
  }
  /** Elementy, których oś toru ma choć jeden punkt w prostokącie świata. */
  piecesInRect(x0, y0, x1, y1) {
    const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0], [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
    const out = new Set();
    for (const s of this.worldSegments(15)) if (!out.has(s.piece) && s.pts.some(([x, y]) => x >= ax && x <= bx && y >= ay && y <= by)) out.add(s.piece);
    return [...out];
  }
  clear() { this.pushUndo(); this.pieces = []; this.scenery = []; this.emit('change'); }
  /** Nowy układ: elementy, nazwa i blat od zera; historia undo wyczyszczona. */
  reset(name) {
    this.pieces = []; this.scenery = []; this.board = { w: 2000, h: 1000, color: DEFAULT_BOARD_COLOR }; this.name = name;
    this.undoStack.length = 0; this.redoStack.length = 0;
    this.emit('change');
  }
  setBoard(w, h) { this.pushUndo(); this.board = { ...this.board, w, h }; this.emit('change'); }
  setBoardColor(color) { if (!/^#[0-9a-f]{6}$/i.test(color) || color === this.board.color) return; this.pushUndo(); this.board = { ...this.board, color }; this.emit('change'); }

  /**
   * Szuka otwartego portu innego elementu w pobliżu któregoś z portów `piece`
   * i zwraca pozę dociągniętą (snap) lub null.
   */
  snapPose(piece, radius = 12) {
    const others = this.openPorts().filter((p) => p.piece !== piece);
    const n = geoOf(piece).ports.length;
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
      // obrzeże obrotnicy: dowolny kąt
      if (!BY_ID[piece.id].turntable) for (const tt of this.pieces) {
        if (!BY_ID[tt.id].turntable || tt === piece) continue;
        const dx = mine.x - tt.x, dy = mine.y - tt.y, dist = Math.hypot(dx, dy);
        if (Math.abs(dist - tt.r) > radius + RIM_TOL) continue;
        const a = norm(Math.atan2(dy, dx) * 180 / Math.PI);
        if (Math.abs(norm(mine.a - a - 180)) > 30) continue;
        const target = { x: tt.x + tt.r * Math.cos(a * Math.PI / 180), y: tt.y + tt.r * Math.sin(a * Math.PI / 180), a, z: tt.z || 0 };
        const d = Math.abs(dist - tt.r);
        if (best && d >= best.d) continue;
        best = { d, pose: Layout.poseFor(piece.id, i, target), rim: { tt, angle: Math.round(a) } };
      }
    }
    if (best?.rim) { const { tt, angle } = best.rim; if (!tt.angles.some((x) => Math.abs(norm(x - angle)) < 0.5)) { tt.angles.push(angle); this._portCache = null; this._segCache.clear(); } }
    return best ? best.pose : null;
  }

  // ---- obrotnica ----
  /** Dodaje port na obrzeżu obrotnicy pod kątem (stopnie, układ świata) i zwraca ten port. */
  addRimPort(tt, angleWorld) {
    const a = Math.round(norm(angleWorld - tt.rot));
    if (!tt.angles.some((x) => Math.abs(norm(x - a)) < 0.5)) { this.pushUndo(); tt.angles.push(a); this.emit('change'); }
    return this.ports().find((p) => p.piece === tt && Math.abs(norm(p.a - angleWorld)) < 0.6);
  }
  setBridge(tt, deg) { this.pushUndo(); tt.bridge = norm(deg); this.emit('change'); }
  setTurntableRadius(tt, r) { this.pushUndo(); tt.r = Math.max(60, Math.min(400, r)); this.emit('change'); }

  // ---- wysokości ----
  /** Elementy osiągalne przez połączone porty, startując z podanych portów (bez przechodzenia przez `block`). */
  reachable(startPorts, block = null) {
    const seen = new Set(), queue = [];
    for (const p of startPorts) if (p.mate && p.mate.piece !== block) queue.push(p.mate.piece);
    while (queue.length) {
      const piece = queue.shift();
      if (seen.has(piece)) continue;
      seen.add(piece);
      for (const port of this.portsOf(piece)) if (port.mate && !seen.has(port.mate.piece) && port.mate.piece !== block) queue.push(port.mate.piece);
    }
    return seen;
  }
  /** Ustawia wysokość początku elementu; cała połączona grupa przesuwa się o tę samą różnicę. */
  setHeight(piece, z) {
    const delta = z - (piece.z || 0);
    if (!delta) return;
    this.pushUndo();
    const group = this.reachable(this.portsOf(piece));
    group.add(piece);
    for (const p of group) p.z = (p.z || 0) + delta;
    this.emit('change');
  }
  /** Ustawia nachylenie elementu [%]; wszystko za jego wyjściami podnosi się o zmianę przyrostu. */
  setGrade(piece, pct) {
    const len = Layout.pieceLength(piece);
    if (!len || BY_ID[piece.id].turntable) return;
    const dz = (pct / 100) * len, delta = dz - (piece.dz || 0);
    if (!delta) return;
    this.pushUndo();
    const exits = this.portsOf(piece).filter((p) => p.idx !== 0);
    const down = this.reachable(exits, piece);
    piece.dz = dz;
    for (const p of down) p.z = (p.z || 0) + delta;
    this.emit('change');
  }
  static grade(piece) { const len = Layout.pieceLength(piece); return len ? ((piece.dz || 0) / len) * 100 : 0; }

  // ---- sceneria ----
  addScenery(type, x, y, rot = 0) {
    const def = SCENERY[type]; if (!def) return null;
    this.pushUndo();
    const item = { uid: nextUid++, type, x, y, rot: norm(rot), w: def.w, h: def.h };
    this.scenery.push(item);
    this.emit('change');
    return item;
  }
  removeScenery(item) { this.pushUndo(); this.scenery = this.scenery.filter((s) => s !== item); this.emit('change'); }
  moveScenery(item, x, y, rot = item.rot, record = true) {
    if (record) this.pushUndo();
    item.x = x; item.y = y; item.rot = norm(rot);
    this.emit(record ? 'change' : 'drag');
  }
  resizeScenery(item, w, h) {
    this.pushUndo();
    const def = SCENERY[item.type];
    item.w = Math.max(10, w); item.h = def.resize === 'uniform' ? item.w : Math.max(10, h);
    this.emit('change');
  }
  /** Obiekt scenerii pod punktem; obiekty "top" mają pierwszeństwo, potem od najmniejszego. */
  hitScenery(x, y) {
    const hits = this.scenery.filter((s) => sceneryHit(s, x, y));
    hits.sort((a, b) => (SCENERY[b.type].layer === 'top') - (SCENERY[a.type].layer === 'top') || a.w * a.h - b.w * b.h);
    return hits[0] || null;
  }

  // ---- geometria świata do rysowania ----
  /** Lista { piece, seg, pts:[[x,y,z],...] } dla wszystkich segmentów (cache per `step`, unieważniany przy każdej zmianie). */
  worldSegments(step = 8) {
    const cached = this._segCache.get(step);
    if (cached) return cached;
    const out = [];
    for (const piece of this.pieces) {
      for (const seg of geoOf(piece).segments) {
        const raw = sampleSegment(seg, step);
        const z0 = piece.z || 0, dz = BY_ID[piece.id].turntable ? 0 : (piece.dz || 0);
        const pts = raw.map(([x, y], i) => { const w = Layout.localToWorld(piece, x, y); return [w.x, w.y, z0 + dz * (raw.length > 1 ? i / (raw.length - 1) : 0)]; });
        out.push({ piece, seg, pts });
      }
    }
    this._segCache.set(step, out);
    return out;
  }

  bounds() {
    if (!this.pieces.length) return { minX: 0, minY: 0, maxX: this.board.w, maxY: this.board.h };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.worldSegments(25)) for (const [x, y] of s.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return { minX, minY, maxX, maxY };
  }

  /** Zakres wysokości elementu [zmin, zmax] (początek i koniec; obrotnica: płasko). */
  static zRange(piece) {
    const n = geoOf(piece).ports.length; let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const z = Layout.portZ(piece, i); lo = Math.min(lo, z); hi = Math.max(hi, z); }
    return n ? [lo, hi] : [piece.z || 0, piece.z || 0];
  }
  /** Czy element należy do przedziału wysokości { min, max } (przecięcie zakresów; null = wszystko). */
  static inLevel(piece, level) {
    if (!level) return true;
    const [lo, hi] = Layout.zRange(piece);
    return hi >= level.min - 1e-6 && lo <= level.max + 1e-6;
  }
  /**
   * Poziomy układu: wysokości końców elementów zgrupowane w skupienia (przerwa > LEVEL_GAP mm zaczyna nowy poziom).
   * Zwraca [{ z, min, max, count }] rosnąco; pojedynczy płaski układ = jeden poziom.
   */
  levels(gap = LEVEL_GAP) {
    const zs = [];
    for (const piece of this.pieces) { const [lo, hi] = Layout.zRange(piece); zs.push(lo, hi); }
    zs.sort((a, b) => a - b);
    const out = [];
    for (const z of zs) {
      const cur = out[out.length - 1];
      if (cur && z - cur.max <= gap) { cur.max = z; cur.sum += z; cur.count++; }
      else out.push({ min: z, max: z, sum: z, count: 1 });
    }
    return out.map((c) => ({ z: Math.round(c.sum / c.count), min: c.min, max: c.max, count: c.count }));
  }

  /** Test trafienia: element, którego oś toru leży w promieniu r od (x,y); `filter(piece)` pozwala pominąć elementy (np. spoza poziomu). */
  hitTest(x, y, r = 12, filter = null) {
    let best = null;
    for (const tt of this.pieces) if (BY_ID[tt.id].turntable && (!filter || filter(tt)) && Math.hypot(x - tt.x, y - tt.y) < tt.r - 10) best = { d: 0, piece: tt };
    for (const s of this.worldSegments(6)) {
      if (filter && !filter(s.piece)) continue;
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
    for (const p of this.pieces) for (const s of geoOf(p).segments) L += segmentLength(s);
    return L;
  }

  // ---- (de)serializacja ----
  toJSON() {
    return {
      version: 2, name: this.name, board: this.board,
      pieces: this.pieces.map((p) => { const o = { id: p.id, x: p.x, y: p.y, rot: p.rot }; if (p.z) o.z = p.z; if (p.dz) o.dz = p.dz; if (p.sw) o.sw = p.sw; if (BY_ID[p.id].turntable) Object.assign(o, { r: p.r, bridge: p.bridge, angles: p.angles }); return o; }),
      scenery: this.scenery.map(({ type, x, y, rot, w, h }) => ({ type, x, y, rot, w, h })),
    };
  }
  load(obj) {
    if (!obj || !Array.isArray(obj.pieces)) throw new Error('Nieprawidłowy plik układu');
    this.pushUndo();
    this.name = obj.name || 'Layout';
    this.board = { w: 2000, h: 1000, color: DEFAULT_BOARD_COLOR, ...(obj.board || {}) };
    if (!/^#[0-9a-f]{6}$/i.test(this.board.color || '')) this.board.color = DEFAULT_BOARD_COLOR;
    this.pieces = obj.pieces.filter((p) => BY_ID[p.id]).map((p) => {
      const o = { uid: nextUid++, id: p.id, x: +p.x || 0, y: +p.y || 0, rot: norm(+p.rot || 0), z: +p.z || 0, dz: +p.dz || 0, sw: +p.sw || 0 };
      if (BY_ID[p.id].turntable) Object.assign(o, { r: +p.r || BY_ID[p.id].r, bridge: norm(+p.bridge || 0), angles: Array.isArray(p.angles) ? p.angles.map(Number) : [] });
      return o;
    });
    this.scenery = (obj.scenery || []).filter((s) => SCENERY[s.type]).map((s) => ({ uid: nextUid++, type: s.type, x: +s.x || 0, y: +s.y || 0, rot: norm(+s.rot || 0), w: +s.w || SCENERY[s.type].w, h: +s.h || SCENERY[s.type].h }));
    this.emit('change');
  }
  save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON())); } catch { /* prywatny tryb Safari */ } }
  static loadSaved(layout) {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) { layout.load(JSON.parse(s)); layout.undoStack.length = 0; return true; } } catch { /* ignoruj */ }
    return false;
  }
}
