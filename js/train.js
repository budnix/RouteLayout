// Symulacja jazdy: pociąg (lokomotywa + wagony) jedzie po osiach elementów,
// przechodzi przez połączone porty, na rozjazdach wybiera trasę wg stanu
// `piece.sw` (indeks aktywnej trasy), zatrzymuje się na ślepym końcu.
//
// Trasa elementu = para portów (routes z katalogu; brak = [[0,1]]) i odpowiadający
// jej segment o tym samym indeksie. Pozycja pociągu: element, trasa, kierunek
// (entry → exit) i dystans s wzdłuż trasy.

import { geoOf, sampleSegment } from './catalog.js';
import { Layout } from './layout.js';

export const LOCO_LEN = 110, WAGON_LEN = 100, GAP = 8, CAR_W = 30;
const d2r = (d) => (d * Math.PI) / 180;
const r2d = (r) => (r * 180) / Math.PI;

/** Trasy elementu: [{ ports:[a,b], seg, pts (lokalne, od portu a do b), len }]. */
export function routesOf(piece) {
  const geo = geoOf(piece);
  const routes = geo.routes || [[0, 1]];
  return routes.map(([a, b], i) => {
    let pts = sampleSegment(geo.segments[Math.min(i, geo.segments.length - 1)], 5);
    const pa = geo.ports[a];
    const dStart = Math.hypot(pts[0][0] - pa.x, pts[0][1] - pa.y), dEnd = Math.hypot(pts[pts.length - 1][0] - pa.x, pts[pts.length - 1][1] - pa.y);
    if (dEnd < dStart) pts = [...pts].reverse();
    let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    return { ports: [a, b], seg: i, pts, len };
  });
}

/** Trasa, którą pociąg wjeżdżający portem `entry` pojedzie (stan rozjazdu `piece.sw`). */
export function routeFrom(piece, entry) {
  const all = routesOf(piece);
  const cands = all.filter((r) => r.ports.includes(entry));
  if (!cands.length) return null;
  const r = cands[(piece.sw || 0) % cands.length];
  const forward = r.ports[0] === entry;
  return { ...r, entry, exit: forward ? r.ports[1] : r.ports[0], forward };
}

export class Train {
  constructor(layout) {
    this.layout = layout;
    this.pos = null;        // { piece, route, s }
    this.speed = 150;       // mm/s (H0: 150 mm/s ≈ 47 km/h)
    this.running = false;
    this.trail = [];        // ostatnie pozy { x, y, a, z, d } (d = dystans skumulowany)
    this.dist = 0;
    this.cars = 2;
  }

  /** Stawia pociąg na elemencie, wjeżdżając portem `entry` (domyślnie 0). */
  place(piece, entry = 0) {
    const route = routeFrom(piece, entry);
    if (!route) return false;
    this.pos = { piece, route, s: Math.min(LOCO_LEN, route.len) };
    this.trail = []; this.dist = 0;
    // ślad startowy: prosto do tyłu, żeby wagony były widoczne od pierwszej klatki
    const p = this.pose();
    const back = LOCO_LEN + this.cars * (WAGON_LEN + GAP) + 20;
    this.trail.push({ x: p.x - back * Math.cos(d2r(p.a)), y: p.y - back * Math.sin(d2r(p.a)), z: p.z, a: p.a, d: -back });
    this.record();
    return true;
  }

  /** Poza lokomotywy (przód) w układzie świata. */
  pose() {
    if (!this.pos) return null;
    const { piece, route, s } = this.pos;
    return poseAlong(piece, route, s);
  }

  record() { const p = this.pose(); if (p) { this.trail.push({ ...p, d: this.dist }); if (this.trail.length > 400) this.trail.splice(0, this.trail.length - 400); } }

  /** Pozy wagonów: cofnięte po śladzie o długości pojazdów. */
  carPoses() {
    const out = [];
    for (let k = 1; k <= this.cars; k++) {
      const back = LOCO_LEN / 2 + GAP + (k - 0.5) * WAGON_LEN + (k - 1) * GAP;
      const p = this.poseBack(back);
      if (p) out.push(p);
    }
    return out;
  }
  poseBack(back) {
    const target = this.dist - back;
    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i - 1], b = this.trail[i];
      if (a.d <= target && target <= b.d) {
        const t = b.d === a.d ? 0 : (target - a.d) / (b.d - a.d);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, a: b.a };
      }
    }
    return null;
  }

  reverse() {
    if (!this.pos) return;
    const { piece, route, s } = this.pos;
    const rev = routeFrom(piece, route.exit);
    if (!rev) return;
    this.pos = { piece, route: rev, s: route.len - s };
    this.trail = []; this.dist = 0;
    const p = this.pose(); const back = LOCO_LEN + this.cars * (WAGON_LEN + GAP) + 20;
    this.trail.push({ x: p.x - back * Math.cos(d2r(p.a)), y: p.y - back * Math.sin(d2r(p.a)), z: p.z, a: p.a, d: -back });
    this.record();
  }

  /** Przesuwa pociąg o dt sekund. Zwraca false, gdy stanął (ślepy tor). */
  step(dt) {
    if (!this.pos || !this.running) return false;
    let remaining = this.speed * dt;
    let guard = 0;
    while (remaining > 0 && guard++ < 50) {
      const { piece, route, s } = this.pos;
      const left = route.len - s;
      if (remaining < left) { this.pos.s += remaining; this.dist += remaining; remaining = 0; break; }
      // koniec trasy: przejdź przez port wyjściowy
      remaining -= left; this.dist += left;
      const exitPort = this.layout.portOf(piece, route.exit);
      const mate = exitPort && exitPort.mate;
      if (!mate) { this.pos.s = route.len; this.running = false; this.record(); return false; }
      const next = routeFrom(mate.piece, mate.idx);
      if (!next) { this.running = false; return false; }
      this.pos = { piece: mate.piece, route: next, s: 0 };
    }
    this.record();
    return true;
  }
}

/** Poza w odległości s wzdłuż trasy elementu (świat). */
export function poseAlong(piece, route, s) {
  const pts = route.forward ? route.pts : [...route.pts].reverse();
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const L = Math.hypot(dx, dy);
    if (acc + L >= s || i === pts.length - 1) {
      const t = L ? Math.min(1, Math.max(0, (s - acc) / L)) : 0;
      const lx = pts[i - 1][0] + dx * t, ly = pts[i - 1][1] + dy * t;
      const w = Layout.localToWorld(piece, lx, ly);
      const a = r2d(Math.atan2(dy, dx)) + piece.rot;
      const z0 = Layout.portZ(piece, route.entry), z1 = Layout.portZ(piece, route.exit);
      return { x: w.x, y: w.y, a, z: z0 + (z1 - z0) * Math.min(1, s / (route.len || 1)) };
    }
    acc += L;
  }
  return null;
}

/** Przełącza rozjazd (kolejna trasa z portu 0). Zwraca nowy stan lub null, gdy element nie ma wyboru. */
export function toggleSwitch(piece) {
  const n = routesOf(piece).filter((r) => r.ports.includes(0)).length;
  if (n < 2) return null;
  piece.sw = ((piece.sw || 0) + 1) % n;
  return piece.sw;
}

/** Aktywna trasa elementu (do podświetlenia): punkty świata. */
export function activeRoutePts(piece) {
  const r = routeFrom(piece, 0);
  if (!r) return null;
  return r.pts.map(([x, y]) => { const w = Layout.localToWorld(piece, x, y); return [w.x, w.y]; });
}

export { d2r };
