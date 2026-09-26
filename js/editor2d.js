// Edytor 2D na Canvas: pan/zoom (mysz, dotyk, pinch), przeciąganie elementów,
// snap do otwartych portów, "kursor" – aktywny otwarty port do auto-rysowania.

import { BY_ID, GAUGE, geoOf } from './catalog.js';
import { SCENERY, drawScenery2D } from './scenery.js';
import { activeRoutePts, LOCO_LEN, WAGON_LEN, CAR_W } from './train.js';
import { Layout, norm } from './layout.js';

const d2r = (d) => (d * Math.PI) / 180;

export class Editor2D {
  constructor(canvas, layout) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layout = layout;
    this.view = { scale: 0.4, ox: 40, oy: 40 }; // px na mm; przesunięcie w px
    this.selected = null;          // element toru
    this.selectedScenery = null;   // obiekt scenerii
    this.cursor = null;            // { uid, idx } – aktywny otwarty port
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.mode = 'edit';            // 'edit' | 'draw'
    this.strokes = [];             // szkic: tablice punktów [x,y] w mm
    this.stroke = null;            // bieżąca kreska
    this.aidGrid = { enabled: false, size: 50 };
    this.normalizer = null;        // fn(points) -> points | null; normalizacja kreski po puszczeniu palca
    this.problems = [];            // znaczniki kontroli wykonalności { type, x, y }
    this.train = null;             // symulacja jazdy (Train) – rysowana w trybie 'train'
    this.selection = new Set();    // zaznaczenie grupowe (elementy toru)
    this.marquee = null;           // prostokąt zaznaczania { x0, y0, x1, y1 } (świat)
    this.dims = false;             // tryb wymiarów
    this.level = null;             // filtr poziomu { min, max } w mm; elementy poza nim są wyszarzone i nieaktywne
    this.listeners = new Set();
    this.dpr = Math.min(devicePixelRatio || 1, 3);

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this._unsubscribe = layout.onChange((kind) => {
      this.validateCursor();
      if (kind === 'change') {   // zaznaczenia nie mogą wskazywać usuniętych elementów
        if (this.selected && !layout.pieces.includes(this.selected)) { this.selected = null; this.emit('select'); }
        if (this.selectedScenery && !layout.scenery.includes(this.selectedScenery)) { this.selectedScenery = null; this.emit('select'); }
        for (const p of this.selection) if (!layout.pieces.includes(p)) this.selection.delete(p);
      }
      this.draw();
    });
    this.resize();
  }

  /** Odpina edytor od układu (renderery tymczasowe, np. druk). */
  dispose() { this._unsubscribe?.(); this._unsubscribe = null; }

  on(fn) { this.listeners.add(fn); }
  emit(kind, payload) { for (const fn of this.listeners) fn(kind, this, payload); }

  // ---- widok ----
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.draw();
  }
  toWorld(px, py) { return { x: (px - this.view.ox) / this.view.scale, y: (py - this.view.oy) / this.view.scale }; }
  toScreen(x, y) { return { x: x * this.view.scale + this.view.ox, y: y * this.view.scale + this.view.oy }; }
  zoomAt(px, py, factor) {
    const s = Math.min(6, Math.max(0.03, this.view.scale * factor));
    const w = this.toWorld(px, py);
    this.view.scale = s;
    this.view.ox = px - w.x * s; this.view.oy = py - w.y * s;
    this.draw();
  }
  fit() {
    const b = this.layout.pieces.length ? this.layout.bounds() : { minX: 0, minY: 0, maxX: this.layout.board.w, maxY: this.layout.board.h };
    const W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr;
    const bw = Math.max(200, b.maxX - b.minX), bh = Math.max(200, b.maxY - b.minY);
    const s = Math.min((W - 60) / bw, (H - 60) / bh);
    this.view.scale = Math.min(4, Math.max(0.03, s));
    this.view.ox = (W - bw * this.view.scale) / 2 - b.minX * this.view.scale;
    this.view.oy = (H - bh * this.view.scale) / 2 - b.minY * this.view.scale;
    this.draw();
  }

  // ---- kursor / zaznaczenie ----
  cursorPort() {
    if (!this.cursor) return null;
    const piece = this.layout.pieces.find((p) => p.uid === this.cursor.uid);
    if (!piece) return null;
    const port = this.layout.portOf(piece, this.cursor.idx);
    return port && !port.mate ? port : null;
  }
  setCursor(port) { this.cursor = port ? { uid: port.piece.uid, idx: port.idx } : null; this.draw(); this.emit('cursor'); }
  validateCursor() {
    if (this.cursor && !this.cursorPort()) {
      // port został połączony lub element zniknął – przeskocz na inny otwarty port tego elementu
      const piece = this.layout.pieces.find((p) => p.uid === this.cursor.uid);
      const alt = piece ? this.layout.openPorts().find((p) => p.piece === piece) : null;
      this.cursor = alt ? { uid: piece.uid, idx: alt.idx } : null;
      this.emit('cursor');
    }
  }
  select(piece) { this.selected = piece; this.draw(); this.emit('select'); }

  /**
   * Dodaje element. Jeśli jest kursor – dokleja go portem `entry` i przesuwa
   * kursor na kolejny otwarty port nowego elementu. Bez kursora – kładzie na
   * środku widoku.
   */
  addPiece(articleId, entry = 0) {
    const def = BY_ID[articleId];
    entry = Math.min(entry, def.geo.ports.length - 1);
    const target = this.cursorPort();
    let piece;
    if (target) {
      piece = this.layout.attach(articleId, entry, target);
    } else {
      const c = this.toWorld(this.canvas.width / this.dpr / 2, this.canvas.height / this.dpr / 2);
      piece = this.layout.add(articleId, { x: c.x, y: c.y, rot: 0 });
    }
    this.selected = piece;
    // następny port: preferuj "prosto" (1), potem kolejne otwarte
    const open = this.layout.openPorts().filter((p) => p.piece === piece && p.idx !== entry);
    const next = open.find((p) => p.idx === 1) || open[0] || null;
    this.cursor = next ? { uid: piece.uid, idx: next.idx } : null;
    this.draw();
    this.emit('select'); this.emit('cursor');
    return piece;
  }

  /** Domyka bieżącą kreskę (np. gdy pointerup nie dotarł) i dodaje ją do szkicu. */
  finishStroke() {
    if (!this.stroke) return;
    if (this.stroke.length > 3) {
      let fixed = null;
      try { fixed = this.normalizer ? this.normalizer(this.stroke) : null; } catch (err) { console.error('normalize', err); }
      this.strokes.push(fixed && fixed.length > 1 ? fixed : this.stroke);
    }
    this.stroke = null; this.drag = null; this.pointers.clear();
    this.draw(); this.emit('sketch');
  }
  setMode(mode) { this.mode = mode; this.stroke = null; this.draw(); this.emit('mode'); }
  clearSketch() { this.strokes = []; this.stroke = null; this.draw(); this.emit('sketch'); }
  undoStroke() { this.strokes.pop(); this.draw(); this.emit('sketch'); }
  setAidGrid(enabled, size) { this.aidGrid = { enabled, size: Math.max(5, size || 50) }; this.draw(); }

  deleteSelected() {
    if (this.selection.size > 1) { const list = [...this.selection]; this.selection.clear(); this.selected = null; this.layout.removeMany(list); this.emit('select'); return; }
    if (this.selectedScenery) { const it = this.selectedScenery; this.selectedScenery = null; this.layout.removeScenery(it); this.emit('select'); return; }
    if (!this.selected) return;
    const p = this.selected;
    this.selected = null;
    this.layout.remove(p);
    this.emit('select');
  }
  rotateSelected(deg) {
    if (this.selection.size > 1) {
      const list = [...this.selection]; let cx = 0, cy = 0; for (const p of list) { cx += p.x; cy += p.y; } cx /= list.length; cy /= list.length;
      this.layout.rotateMany(list, deg, cx, cy); return;
    }
    if (this.selected && BY_ID[this.selected.id].turntable) { this.layout.setBridge(this.selected, (this.selected.bridge || 0) + deg); return; }
    if (this.selectedScenery) this.layout.moveScenery(this.selectedScenery, this.selectedScenery.x, this.selectedScenery.y, this.selectedScenery.rot + deg);
    else if (this.selected) this.layout.rotate(this.selected, deg);
  }
  /** Wstawia obiekt scenerii na środku widoku i zaznacza go. */
  addScenery(type) {
    const c = this.toWorld(this.canvas.width / this.dpr / 2, this.canvas.height / this.dpr / 2);
    const item = this.layout.addScenery(type, c.x, c.y, 0);
    this.selectedScenery = item; this.selected = null;
    this.draw(); this.emit('select');
    return item;
  }

  // ---- wejście ----
  pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = null; this.stroke = null;
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ox: this.view.ox, oy: this.view.oy, scale: this.view.scale };
      return;
    }
    const w = this.toWorld(p.x, p.y);
    if (this.mode === 'draw') { this.stroke = [[w.x, w.y]]; this.drag = { start: p, moved: false, draw: true }; return; }
    if (this.mode === 'train') { const piece = this.layout.hitTest(w.x, w.y, Math.max(14 / this.view.scale, 10), this.levelFilter()); this.drag = { start: p, moved: false, piece: null, tapPiece: piece, ox: this.view.ox, oy: this.view.oy }; return; }
    if (this.mode === 'marquee') { this.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; this.drag = { start: p, moved: false, marquee: true }; return; }
    const tol = 14 / this.view.scale; // ~14 px
    const port = this.nearestOpenPort(w, tol);
    const piece = this.layout.hitTest(w.x, w.y, Math.max(tol, 10), this.levelFilter());
    const rim = !port ? this.hitRim(w, tol) : null;
    const scen = !port && !piece && !rim ? this.layout.hitScenery(w.x, w.y) : null;
    this.drag = { start: p, last: p, moved: false, piece: port || rim ? null : piece, scen, port, rim, ox: this.view.ox, oy: this.view.oy, px: piece?.x ?? scen?.x, py: piece?.y ?? scen?.y };
    if (rim) { this.selected = rim.tt; this.selectedScenery = null; this.emit('select'); this.draw(); return; }
    if (piece && !port && this.selection.has(piece)) { this.drag.group = [...this.selection].map((q) => ({ q, x: q.x, y: q.y })); this.drag.piece = null; }
    else if (piece && !port) { this.selection.clear(); this.selected = piece; this.selectedScenery = null; this.emit('select'); this.draw(); }
    else if (scen) { this.selectedScenery = scen; this.selected = null; this.emit('select'); this.draw(); }
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const s = Math.min(6, Math.max(0.03, this.pinch.scale * (d / this.pinch.d)));
      // punkt świata pod środkiem pinch ma zostać pod środkiem
      const wx = (this.pinch.cx - this.pinch.ox) / this.pinch.scale, wy = (this.pinch.cy - this.pinch.oy) / this.pinch.scale;
      this.view.scale = s; this.view.ox = cx - wx * s; this.view.oy = cy - wy * s;
      this.draw();
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (d.marquee) { const w = this.toWorld(p.x, p.y); this.marquee.x1 = w.x; this.marquee.y1 = w.y; d.moved = true; this.draw(); return; }
    if (d.group) {
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 6) return;
      d.moved = true;
      const dx = (p.x - d.start.x) / this.view.scale, dy = (p.y - d.start.y) / this.view.scale;
      for (const g of d.group) { g.q.x = g.x + dx; g.q.y = g.y + dy; }
      this.layout.emit('drag'); return;
    }
    if (d.draw) { const w = this.toWorld(p.x, p.y); this.stroke?.push([w.x, w.y]); d.moved = true; this.draw(); return; }
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 6) return;
    d.moved = true;
    if (d.piece) {
      const dx = (p.x - d.start.x) / this.view.scale, dy = (p.y - d.start.y) / this.view.scale;
      this.layout.move(d.piece, d.px + dx, d.py + dy, d.piece.rot, false);
    } else if (d.scen) {
      const dx = (p.x - d.start.x) / this.view.scale, dy = (p.y - d.start.y) / this.view.scale;
      this.layout.moveScenery(d.scen, d.px + dx, d.py + dy, d.scen.rot, false);
    } else {
      this.view.ox = d.ox + (p.x - d.start.x); this.view.oy = d.oy + (p.y - d.start.y);
      this.draw();
    }
  }

  onUp(e) {
    const p = this.pos(e);
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.drag = null; return; }
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (d.marquee) {
      const m = this.marquee; this.marquee = null;
      const found = d.moved && m ? this.layout.piecesInRect(m.x0, m.y0, m.x1, m.y1) : [];
      this.selection = new Set(found);
      this.selected = found.length === 1 ? found[0] : null; this.selectedScenery = null;
      this.setMode('edit'); this.emit('select'); this.draw();
      return;
    }
    if (d.group) {
      if (!d.moved) { return; }
      // przywróć stan sprzed i zapisz jako jeden krok undo
      const dx = d.group[0].q.x - d.group[0].x, dy = d.group[0].q.y - d.group[0].y;
      for (const g of d.group) { g.q.x = g.x; g.q.y = g.y; }
      this.layout.moveMany(d.group.map((g) => g.q), dx, dy, true);
      return;
    }
    if (d.draw) {
      if (this.stroke && this.stroke.length > 3) {
        let fixed = null;
        try { fixed = this.normalizer ? this.normalizer(this.stroke) : null; }
        catch (err) { console.error('normalize', err); window.dispatchEvent(new CustomEvent('railsketch:error', { detail: err })); }
        this.strokes.push(fixed && fixed.length > 1 ? fixed : this.stroke);
        this.emit('sketch');
      }
      this.stroke = null; this.draw();
      return;
    }
    if (!d.moved) {
      // tap
      if (this.mode === 'train') { if (d.tapPiece) this.emit('switch', d.tapPiece); return; }
      if (d.rim) { const port = this.layout.addRimPort(d.rim.tt, d.rim.angle); if (port) this.setCursor(port); return; }
      if (d.port) { this.setCursor(d.port); this.selected = d.port.piece; this.selectedScenery = null; this.emit('select'); }
      else if (!d.piece && !d.scen) { this.selected = null; this.selectedScenery = null; this.selection.clear(); this.emit('select'); this.draw(); }
      return;
    }
    if (d.scen) {
      const { x, y } = d.scen; d.scen.x = d.px; d.scen.y = d.py;
      this.layout.moveScenery(d.scen, x, y, d.scen.rot, true);
      return;
    }
    if (d.piece) {
      // zakończ przeciąganie: snap + zapis w undo
      const snap = this.layout.snapPose(d.piece, 18 / this.view.scale + 6);
      const target = snap || { x: d.piece.x, y: d.piece.y, rot: d.piece.rot };
      d.piece.x = d.px; d.piece.y = d.py; // przywróć stan sprzed, żeby snapshot undo był poprawny
      this.layout.move(d.piece, target.x, target.y, target.rot, true);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.pos(e);
    if (e.ctrlKey || e.metaKey || !e.shiftKey) this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    else { this.view.ox -= e.deltaX; this.view.oy -= e.deltaY; this.draw(); }
  }

  /** Obrzeże obrotnicy pod punktem: { tt, angle } (kąt w układzie świata). */
  hitRim(w, tol) {
    for (const tt of this.layout.pieces) {
      if (!BY_ID[tt.id].turntable) continue;
      const dx = w.x - tt.x, dy = w.y - tt.y, d = Math.hypot(dx, dy);
      if (Math.abs(d - tt.r) <= Math.max(tol, 10)) return { tt, angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI) };
    }
    return null;
  }

  nearestOpenPort(w, tol) {
    let best = null;
    for (const port of this.layout.openPorts()) {
      if (this.level && !Layout.inLevel(port.piece, this.level)) continue;
      const d = Math.hypot(port.x - w.x, port.y - w.y);
      if (d < tol && (!best || d < best.d)) best = { d, port };
    }
    return best ? best.port : null;
  }

  // ---- rysowanie ----
  draw() {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const s = this.view.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getCSS('--c-bg-editor', '#e9eef2');
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(s, 0, 0, s, this.view.ox * this.dpr, this.view.oy * this.dpr);

    // blat
    const { w, h } = this.layout.board;
    ctx.fillStyle = tint(this.layout.board.color, getCSS('--c-board', '#f7f4ea'));
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 2 / s;
    ctx.strokeStyle = getCSS('--c-board-edge', '#b9a98a');
    ctx.strokeRect(0, 0, w, h);
    // siatka 100 mm
    if (s > 0.15) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h; y += 100) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.strokeStyle = getCSS('--c-grid', 'rgba(0,0,0,0.07)');
      ctx.lineWidth = 1 / s;
      ctx.stroke();
    }

    // siatka pomocnicza (pomoc w szkicowaniu) – na całym widocznym obszarze
    if (this.aidGrid.enabled && this.aidGrid.size * s >= 6) {
      const g = this.aidGrid.size;
      const tl = this.toWorld(0, 0), br = this.toWorld(W / this.dpr, H / this.dpr);
      ctx.beginPath();
      for (let x = Math.floor(tl.x / g) * g; x <= br.x; x += g) { ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y); }
      for (let y = Math.floor(tl.y / g) * g; y <= br.y; y += g) { ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y); }
      ctx.strokeStyle = getCSS('--c-aid-grid', 'rgba(30,120,220,0.18)');
      ctx.lineWidth = 1 / s;
      ctx.stroke();
    }

    // sceneria – warstwa terenu (drogi, stawy, wzgórza, perony) pod torami
    for (const it of this.layout.scenery) if (SCENERY[it.type].layer === 'ground') drawScenery2D(ctx, it, it === this.selectedScenery);

    // obrotnice: niecka i obrzeże
    for (const tt of this.layout.pieces) {
      if (!BY_ID[tt.id].turntable) continue;
      ctx.beginPath(); ctx.arc(tt.x, tt.y, tt.r, 0, Math.PI * 2);
      ctx.fillStyle = getCSS('--c-pit', '#8d8a84'); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(tt.x, tt.y, tt.r - 6, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    const allSegs = this.layout.worldSegments(8);
    const inLevel = this.levelFilter();
    const segs = inLevel ? allSegs.filter((sg) => inLevel(sg.piece)) : allSegs;
    const tracePath = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    // elementy poza wybranym poziomem: blady ślad pod spodem (widać kontekst, nie można ich stuknąć)
    if (inLevel) {
      ctx.save(); ctx.globalAlpha = 0.28; ctx.strokeStyle = getCSS('--c-rail', '#4c4c4c'); ctx.lineWidth = 30;
      for (const sg of allSegs) if (!inLevel(sg.piece)) { tracePath(sg.pts); ctx.stroke(); }
      ctx.restore();
    }

    // podsypka
    ctx.strokeStyle = getCSS('--c-ballast', '#c9c2b4'); ctx.lineWidth = 34;
    for (const sg of segs) { tracePath(sg.pts); ctx.stroke(); }
    // podkłady (sugestia): ciemniejszy pas
    ctx.strokeStyle = getCSS('--c-sleeper', '#8d7b64'); ctx.lineWidth = 26;
    for (const sg of segs) { tracePath(sg.pts); ctx.stroke(); }
    // środek między szynami
    ctx.strokeStyle = getCSS('--c-ballast', '#c9c2b4'); ctx.lineWidth = GAUGE - 2.4;
    for (const sg of segs) { tracePath(sg.pts); ctx.stroke(); }
    // szyny jako dwie linie – rysujemy gruby ciemny pas i cieńszy jasny w środku
    ctx.strokeStyle = getCSS('--c-rail', '#4c4c4c'); ctx.lineWidth = GAUGE + 1.2;
    ctx.globalCompositeOperation = 'source-over';
    for (const sg of segs) { tracePath(sg.pts); ctx.stroke(); }
    ctx.strokeStyle = getCSS('--c-ballast', '#c9c2b4'); ctx.lineWidth = GAUGE - 1.2;
    for (const sg of segs) { tracePath(sg.pts); ctx.stroke(); }
    // ponownie podkłady prześwitujące między szynami (kreski)
    if (s > 0.25) {
      ctx.strokeStyle = getCSS('--c-sleeper', '#8d7b64'); ctx.lineWidth = 3;
      ctx.beginPath();
      for (const sg of segs) {
        const pts = sg.pts; let acc = 0, nextAt = 4;
        for (let i = 1; i < pts.length; i++) {
          const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], L = Math.hypot(dx, dy);
          while (acc + L >= nextAt) {
            const t = (nextAt - acc) / L, px = pts[i - 1][0] + dx * t, py = pts[i - 1][1] + dy * t;
            const nx = -dy / L, ny = dx / L, hw = GAUGE / 2 - 0.6;
            ctx.moveTo(px - nx * hw, py - ny * hw); ctx.lineTo(px + nx * hw, py + ny * hw);
            nextAt += 7.6;
          }
          acc += L;
        }
      }
      ctx.stroke();
    }

    // zaznaczenie grupowe
    if (this.selection.size) {
      ctx.strokeStyle = getCSS('--c-accent', '#ff7a1a'); ctx.lineWidth = 4 / s + 2; ctx.setLineDash([12 / s, 8 / s]);
      for (const sg of segs) if (this.selection.has(sg.piece)) { tracePath(sg.pts); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (this.marquee) {
      const m = this.marquee;
      ctx.fillStyle = 'rgba(29,111,214,0.12)'; ctx.strokeStyle = 'rgba(29,111,214,0.9)'; ctx.lineWidth = 1.5 / s; ctx.setLineDash([6 / s, 4 / s]);
      ctx.fillRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0); ctx.strokeRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0); ctx.setLineDash([]);
    }
    if (this.dims) this.drawDims(ctx, s);

    // zaznaczenie
    if (this.selected && this.selection.size <= 1) {
      ctx.strokeStyle = getCSS('--c-accent', '#ff7a1a'); ctx.lineWidth = 4 / s + 2;
      ctx.setLineDash([12 / s, 8 / s]);
      for (const sg of segs) if (sg.piece === this.selected) { tracePath(sg.pts); ctx.stroke(); }
      ctx.setLineDash([]);
    }

    // etykiety
    if (s > 0.5) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.font = `${12 / this.view.scale}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const piece of this.layout.pieces) {
        const def = BY_ID[piece.id];
        const sg = geoOf(piece).segments[0];
        const mid = sg.type === 'line' ? { x: (sg.x1 + sg.x2) / 2, y: (sg.y1 + sg.y2) / 2 } : (() => { const a = d2r((sg.a0 + sg.a1) / 2); return { x: sg.cx + sg.r * Math.cos(a), y: sg.cy + sg.r * Math.sin(a) }; })();
        const wpt = Layout.localToWorld(piece, mid.x, mid.y - 22);
        ctx.fillText(def.code, wpt.x, wpt.y);
        if (piece.z || piece.dz) {
          const z1 = (piece.z || 0) + (piece.dz || 0);
          const wz = Layout.localToWorld(piece, mid.x, mid.y + 24);
          ctx.fillStyle = '#1d6fd6';
          ctx.fillText(piece.dz ? `${Math.round(piece.z)}→${Math.round(z1)} mm` : `${Math.round(piece.z)} mm`, wz.x, wz.y);
          ctx.fillStyle = 'rgba(0,0,0,0.75)';
        }
      }
    }

    // sceneria – obiekty nad torami (drzewa, budynki)
    for (const it of this.layout.scenery) if (SCENERY[it.type].layer !== 'ground') drawScenery2D(ctx, it, it === this.selectedScenery);

    // szkic
    const strokes = this.stroke ? [...this.strokes, this.stroke] : this.strokes;
    if (strokes.length) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = getCSS('--c-sketch', 'rgba(255,122,26,0.55)'); ctx.lineWidth = 12;
      for (const st of strokes) { tracePath(st); ctx.stroke(); }
      ctx.lineWidth = 2 / s; ctx.strokeStyle = getCSS('--c-accent', '#ff7a1a');
      for (const st of strokes) { tracePath(st); ctx.stroke(); }
    }

    // tryb jazdy: aktywne trasy rozjazdów i pociąg
    if (this.mode === 'train') {
      ctx.lineCap = 'round';
      for (const piece of this.layout.pieces) {
        const g = BY_ID[piece.id].geo;
        if (!g.routes || g.routes.length < 2) continue;
        const pts = activeRoutePts(piece);
        if (!pts) continue;
        tracePath(pts); ctx.strokeStyle = 'rgba(46,158,91,0.85)'; ctx.lineWidth = 6; ctx.stroke();
      }
      if (this.train && this.train.pos) {
        const car = (pose, L, color) => {
          ctx.save(); ctx.translate(pose.x, pose.y); ctx.rotate(d2r(pose.a));
          ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-L / 2, -CAR_W / 2, L, CAR_W, 5) : ctx.rect(-L / 2, -CAR_W / 2, L, CAR_W); ctx.fill(); ctx.stroke();
          ctx.restore();
        };
        for (const w of this.train.carPoses()) car(w, WAGON_LEN, '#3b6fb6');
        const lp = this.train.pose(); if (lp) car(lp, LOCO_LEN, '#c62828');
      }
    }

    // znaczniki problemów
    if (this.problems.length) {
      const r = Math.max(9 / s, 7);
      for (const pr of this.problems) {
        ctx.beginPath(); ctx.arc(pr.x, pr.y, r, 0, Math.PI * 2);
        ctx.fillStyle = pr.type === 'edge' || pr.type === 'grade' ? 'rgba(224,160,32,0.95)' : 'rgba(214,58,58,0.95)'; ctx.fill();
        ctx.lineWidth = 1.5 / s; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `bold ${r * 1.4}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('!', pr.x, pr.y + r * 0.05);
      }
    }

    // otwarte porty
    const cur = this.cursorPort();
    const r = Math.max(5 / s, 4);
    for (const port of this.layout.openPorts()) {
      if (this.level && !Layout.inLevel(port.piece, this.level)) continue;
      const isCur = cur && port.piece === cur.piece && port.idx === cur.idx;
      ctx.beginPath(); ctx.arc(port.x, port.y, isCur ? r * 1.5 : r, 0, Math.PI * 2);
      ctx.fillStyle = isCur ? getCSS('--c-accent', '#ff7a1a') : 'rgba(30,120,220,0.85)';
      ctx.fill();
      if (isCur) {
        // strzałka kierunku
        const a = d2r(port.a), L = r * 4;
        ctx.beginPath(); ctx.moveTo(port.x, port.y); ctx.lineTo(port.x + Math.cos(a) * L, port.y + Math.sin(a) * L);
        ctx.strokeStyle = getCSS('--c-accent', '#ff7a1a'); ctx.lineWidth = r * 0.6; ctx.stroke();
      }
    }
  }
}

/** Bardzo jasna wersja koloru blatu (2D ma zostać czytelne): 82% w stronę tła planu. */
function tint(hex, base) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return base;
  const m = base.match(/#([0-9a-f]{6})/i);
  const b = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [247, 244, 234];
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${c.map((v, i) => Math.round(v * 0.18 + b[i] * 0.82)).join(',')})`;
}

/** Tryb wymiarów: długości prostych, promienie łuków, odstępy równoległych prostych, blat. */
/** Funkcja filtrująca elementy według aktywnego poziomu (null = bez filtra). */
Editor2D.prototype.levelFilter = function levelFilter() { const lv = this.level; return lv ? (piece) => Layout.inLevel(piece, lv) : null; };
/** Ustawia filtr poziomu { min, max } lub null; zaznaczenie spoza poziomu jest zdejmowane. */
Editor2D.prototype.setLevel = function setLevel(level) {
  this.level = level;
  if (level && this.selected && !Layout.inLevel(this.selected, level)) { this.selected = null; this.emit('select'); }
  if (level) for (const p of [...this.selection]) if (!Layout.inLevel(p, level)) this.selection.delete(p);
  if (level && this.cursor && this.cursor.uid) { const cp = this.cursorPort(); if (cp && !Layout.inLevel(cp.piece, level)) { this.cursor = null; this.emit('cursor'); } }
  this.emit('level'); this.draw();
};

Editor2D.prototype.drawDims = function drawDims(ctx, s) {
  const font = `${11 / this.view.scale}px system-ui, sans-serif`;
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const label = (x, y, text, color = '#1d6fd6') => {
    const w = ctx.measureText(text).width + 8 / this.view.scale, h = 15 / this.view.scale;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  };
  const fmt = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
  const { w, h } = this.layout.board;
  ctx.strokeStyle = 'rgba(29,111,214,0.8)'; ctx.lineWidth = 1.2 / s;
  // blat
  ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(w, -30); ctx.moveTo(-30, 0); ctx.lineTo(-30, h); ctx.stroke();
  label(w / 2, -30, `${w} mm`); ctx.save(); ctx.translate(-30, h / 2); ctx.rotate(-Math.PI / 2); label(0, 0, `${h} mm`); ctx.restore();
  // elementy
  const straights = [];
  for (const piece of this.layout.pieces) {
    const def = BY_ID[piece.id];
    const seg = geoOf(piece).segments[0];
    if (!seg) continue;
    if (seg.type === 'arc') {
      const a = d2r((seg.a0 + seg.a1) / 2);
      const m = Layout.localToWorld(piece, seg.cx + (seg.r + 45) * Math.cos(a), seg.cy + (seg.r + 45) * Math.sin(a));
      label(m.x, m.y, `R ${fmt(seg.r)} · ${fmt(Math.abs(seg.a1 - seg.a0))}°`);
    } else if (!def.turntable && def.group === 'straight') {
      const L = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      const m = Layout.localToWorld(piece, (seg.x1 + seg.x2) / 2, (seg.y1 + seg.y2) / 2 + 26);
      label(m.x, m.y, `${fmt(L)} mm`);
      const p0 = Layout.localToWorld(piece, seg.x1, seg.y1), p1 = Layout.localToWorld(piece, seg.x2, seg.y2);
      straights.push({ piece, p0, p1, a: piece.rot });
    }
  }
  // odstępy równoległych prostych (kąt ±1,5°, odstęp 40–250 mm, wspólny odcinek > 50 mm)
  const done = new Set();
  for (let i = 0; i < straights.length; i++) for (let j = i + 1; j < straights.length; j++) {
    const A = straights[i], B = straights[j];
    const da = Math.abs(norm(A.a - B.a)); if (Math.min(da, 180 - da) > 1.5) continue;
    const ux = Math.cos(d2r(A.a)), uy = Math.sin(d2r(A.a)), nx = -uy, ny = ux;
    const off = (B.p0.x - A.p0.x) * nx + (B.p0.y - A.p0.y) * ny;
    if (Math.abs(off) < 40 || Math.abs(off) > 250) continue;
    const t = (p) => (p.x - A.p0.x) * ux + (p.y - A.p0.y) * uy;
    const lo = Math.max(Math.min(t(A.p0), t(A.p1)), Math.min(t(B.p0), t(B.p1))), hi = Math.min(Math.max(t(A.p0), t(A.p1)), Math.max(t(B.p0), t(B.p1)));
    if (hi - lo < 50) continue;
    const key = `${Math.round(off)}:${Math.round((lo + hi) / 2 / 50)}`; if (done.has(key)) continue; done.add(key);
    const tm = (lo + hi) / 2, x = A.p0.x + ux * tm, y = A.p0.y + uy * tm;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + nx * off, y + ny * off); ctx.stroke();
    label(x + nx * off / 2, y + ny * off / 2, `${fmt(Math.abs(off))} mm`, '#b3261e');
  }
};

function getCSS(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export { norm };
