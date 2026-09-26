// Kontrola wykonalności układu. Zwraca listę problemów { type, x, y, pieces, params }.
//
//  grade     – nachylenie elementu > MAX_GRADE
//  clearance – tor nad torem z prześwitem < MIN_CLEARANCE (a > 3 mm, więc nie to samo miejsce)
//  collision – osie dwóch niepołączonych elementów przecinają się na tym samym poziomie
//  spacing   – osie dwóch niepołączonych elementów bliżej niż MIN_SPACING (wagony się zahaczą)
//  envelope  – obrysy taboru (szerokość + wybieg na łuku) zachodzą na siebie przy danym odstępie osi
//  radius    – promień łuku za mały dla wybranego taboru
//  edge      – tor poza blatem lub bliżej krawędzi niż EDGE_MARGIN

import { BY_ID } from './catalog.js';
import { Layout } from './layout.js';
import { SpatialHash } from './spatial.js';

export const MAX_GRADE = 3.5;        // %
export const MIN_CLEARANCE = 55;     // mm (H0: wagony piętrowe ~ 55–60 mm)
export const MIN_SPACING = 45;       // mm między osiami (standard PIKO 61,88)
export const EDGE_MARGIN = 20;       // mm
const SAME_LEVEL = 3;                // mm – jak w łączeniu portów
const STEP = 15;                     // mm – próbkowanie osi

// Obrys taboru (H0). Pół szerokości pudła na prostej ≈ 18 mm (NEM 301: 3,15 m) + luz → HALF_WIDTH.
// Na łuku dochodzi wybieg: zewnętrzny (len² − pivot²)/(8R), wewnętrzny pivot²/(8R); bierzemy większy.
export const HALF_WIDTH = 20;        // mm
export const ENV_MARGIN = 3;         // mm – luz między obrysami
export const STOCK = {
  short:    { len: 165, pivot: 110, minRadius: 0 },     // wagony 2-osiowe, krótkie towarowe
  standard: { len: 240, pivot: 175, minRadius: 0 },     // wagony osobowe 1:100, typowe 4-osiowe
  long:     { len: 303, pivot: 220, minRadius: 420 },   // wagony 1:87 (26,4 m) – R1 za ciasne
};
export const DEFAULT_STOCK = 'standard';
/** Pół szerokości obrysu po stronie `side` łuku: 'outer' (wybieg pudła na zewnątrz), 'inner' (wybieg środka do wewnątrz) lub 'max'. */
export function envelopeHalf(radius, stock = STOCK[DEFAULT_STOCK], side = 'max') {
  if (!isFinite(radius) || radius <= 0) return HALF_WIDTH;
  const { len, pivot } = stock;
  const outer = (len * len - pivot * pivot) / (8 * radius), inner = (pivot * pivot) / (8 * radius);
  return HALF_WIDTH + (side === 'outer' ? outer : side === 'inner' ? inner : Math.max(outer, inner));
}
/**
 * Wymagany odstęp osi dwóch torów o promieniach rA, rB (Infinity = prosta); `sideA`/`sideB` mówią,
 * po której stronie łuku leży drugi tor (współśrodkowe R1‖R2: wewnętrzny 'outer', zewnętrzny 'inner').
 */
export function requiredSpacing(rA, rB, stock = STOCK[DEFAULT_STOCK], sideA = 'max', sideB = 'max') { return envelopeHalf(rA, stock, sideA) + envelopeHalf(rB, stock, sideB) + ENV_MARGIN; }
/** Po której stronie łuku segmentu leży punkt (px, py) świata: 'outer' (dalej od środka niż promień) lub 'inner'. */
function sideOf(s, px, py) {
  if (s.seg.type !== 'arc') return 'max';
  const c = Layout.localToWorld(s.piece, s.seg.cx, s.seg.cy);
  return Math.hypot(px - c.x, py - c.y) > s.seg.r ? 'outer' : 'inner';
}
const MAX_REQ = 80;                  // mm – górna granica wymaganego odstępu (R1 + długi tabor ≈ 73)
const GRID_CELL = 250;               // mm – komórka siatki kandydatów (≈ długość elementu)

export function checkLayout(layout, { stock = DEFAULT_STOCK } = {}) {
  const st = STOCK[stock] || STOCK[DEFAULT_STOCK];
  const out = [];
  const { w, h } = layout.board;
  const segs = layout.worldSegments(STEP);

  // 1. nachylenie
  for (const piece of layout.pieces) {
    const g = Math.abs(layoutGrade(piece));
    if (g > MAX_GRADE) { const s = segs.find((x) => x.piece === piece); const m = s ? s.pts[Math.floor(s.pts.length / 2)] : [piece.x, piece.y]; out.push({ type: 'grade', x: m[0], y: m[1], pieces: [piece], params: { g: g.toFixed(1) } }); }
  }

  // 1b. promień za mały dla taboru
  if (st.minRadius) for (const s of segs) {
    if (s.seg.type !== 'arc' || s.seg.r >= st.minRadius - 1e-6) continue;
    if (out.some((o) => o.type === 'radius' && o.pieces[0] === s.piece)) continue;
    const m = s.pts[Math.floor(s.pts.length / 2)];
    out.push({ type: 'radius', x: m[0], y: m[1], pieces: [s.piece], params: { r: Math.round(s.seg.r), min: st.minRadius } });
  }

  // 2. krawędź blatu
  for (const s of segs) {
    const bad = s.pts.find(([x, y]) => x < EDGE_MARGIN || y < EDGE_MARGIN || x > w - EDGE_MARGIN || y > h - EDGE_MARGIN);
    if (bad) { if (!out.some((o) => o.type === 'edge' && o.pieces[0] === s.piece)) out.push({ type: 'edge', x: bad[0], y: bad[1], pieces: [s.piece], params: {} }); }
  }

  // 3–5. relacje między elementami (bez par połączonych bezpośrednio)
  const connected = new Set();
  const neighbours = new Map();   // piece -> [{ piece: sąsiad, x, y }] (port łączący)
  for (const p of layout.ports()) if (p.mate) {
    connected.add(key(p.piece, p.mate.piece));
    if (!neighbours.has(p.piece)) neighbours.set(p.piece, []);
    neighbours.get(p.piece).push({ piece: p.mate.piece, x: p.x, y: p.y });
  }
  // A i B rozchodzą się z tego samego elementu (np. odnogi rozjazdu): bliskość przy jego porcie jest naturalna
  const sharedJointNear = (A, B, x, y) => {
    for (const na of neighbours.get(A) || []) for (const nb of neighbours.get(B) || []) {
      if (na.piece === nb.piece && Math.hypot(na.x - x, na.y - y) < 300 && Math.hypot(nb.x - x, nb.y - y) < 300) return true;
    }
    return false;
  };
  // kandydaci przez siatkę przestrzenną: tylko pary segmentów, których poszerzone obwiednie dzielą komórkę
  const boxes = segs.map((s) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0 - MAX_REQ, y0 - MAX_REQ, x1 + MAX_REQ, y1 + MAX_REQ]; });
  const grid = new SpatialHash(GRID_CELL);
  boxes.forEach((b, i) => grid.addBox(b[0], b[1], b[2], b[3], i));
  const reported = new Set();
  for (const [i, j] of grid.pairs()) {
    const A = segs[i], B = segs[j];
    if (A.piece === B.piece) continue;
    if (connected.has(key(A.piece, B.piece))) continue;
    const a = boxes[i], b = boxes[j];
    if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
    // najbliższa para próbek
    let best = null, bestD2 = MAX_REQ * MAX_REQ;   // bez sqrt w pętli wewnętrznej
    for (const p of A.pts) for (const q of B.pts) {
      const dx = p[0] - q[0], dy = p[1] - q[1], d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) { bestD2 = d2; best = { d: Math.sqrt(d2), p, q }; }
    }
    if (!best) continue;
    const dz = Math.abs((best.p[2] || 0) - (best.q[2] || 0));
    const k = key(A.piece, B.piece);
    if (reported.has(k)) continue;
    const x = (best.p[0] + best.q[0]) / 2, y = (best.p[1] + best.q[1]) / 2;
    if (dz <= SAME_LEVEL && !polylinesCross(A.pts, B.pts) && sharedJointNear(A.piece, B.piece, x, y)) continue;
    if (dz > SAME_LEVEL) {
      if (dz < MIN_CLEARANCE && polylinesCross(A.pts, B.pts)) { reported.add(k); out.push({ type: 'clearance', x, y, pieces: [A.piece, B.piece], params: { dz: Math.round(dz), min: MIN_CLEARANCE } }); }
      continue;
    }
    const rA = A.seg.type === 'arc' ? A.seg.r : Infinity, rB = B.seg.type === 'arc' ? B.seg.r : Infinity;
    const need = requiredSpacing(rA, rB, st, sideOf(A, best.q[0], best.q[1]), sideOf(B, best.p[0], best.p[1]));
    if (best.d > MIN_SPACING && best.d >= need) continue;
    reported.add(k);
    if (polylinesCross(A.pts, B.pts)) out.push({ type: 'collision', x, y, pieces: [A.piece, B.piece], params: {} });
    else if (best.d <= MIN_SPACING) out.push({ type: 'spacing', x, y, pieces: [A.piece, B.piece], params: { d: Math.round(best.d), min: MIN_SPACING } });
    else out.push({ type: 'envelope', x, y, pieces: [A.piece, B.piece], params: { d: Math.round(best.d), min: Math.ceil(need), r: Math.round(Math.min(rA, rB)) } });
  }
  return out;
}

const key = (a, b) => (a.uid < b.uid ? `${a.uid}:${b.uid}` : `${b.uid}:${a.uid}`);

function layoutGrade(piece) {
  const def = BY_ID[piece.id];
  if (def.turntable) return 0;
  const seg = def.geo.segments[0];
  const L = seg.type === 'line' ? Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) : Math.abs((seg.a1 - seg.a0) * Math.PI / 180) * seg.r;
  return L ? ((piece.dz || 0) / L) * 100 : 0;
}

/** Czy dwie łamane się przecinają (test odcinek–odcinek). */
export function polylinesCross(P, Q) {
  for (let i = 1; i < P.length; i++) for (let j = 1; j < Q.length; j++) {
    if (segmentsIntersect(P[i - 1], P[i], Q[j - 1], Q[j])) return true;
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
