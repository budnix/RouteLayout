// Kontrola wykonalności układu. Zwraca listę problemów { type, x, y, pieces, params }.
//
//  grade     – nachylenie elementu > MAX_GRADE
//  clearance – tor nad torem z prześwitem < MIN_CLEARANCE (a > 3 mm, więc nie to samo miejsce)
//  collision – osie dwóch niepołączonych elementów przecinają się na tym samym poziomie
//  spacing   – osie dwóch niepołączonych elementów bliżej niż MIN_SPACING (wagony się zahaczą)
//  edge      – tor poza blatem lub bliżej krawędzi niż EDGE_MARGIN

import { BY_ID } from './catalog.js';

export const MAX_GRADE = 3.5;        // %
export const MIN_CLEARANCE = 55;     // mm (H0: wagony piętrowe ~ 55–60 mm)
export const MIN_SPACING = 45;       // mm między osiami (standard PIKO 61,88)
export const EDGE_MARGIN = 20;       // mm
const SAME_LEVEL = 3;                // mm – jak w łączeniu portów
const STEP = 15;                     // mm – próbkowanie osi

export function checkLayout(layout) {
  const out = [];
  const { w, h } = layout.board;
  const segs = layout.worldSegments(STEP);

  // 1. nachylenie
  for (const piece of layout.pieces) {
    const g = Math.abs(layoutGrade(piece));
    if (g > MAX_GRADE) { const s = segs.find((x) => x.piece === piece); const m = s ? s.pts[Math.floor(s.pts.length / 2)] : [piece.x, piece.y]; out.push({ type: 'grade', x: m[0], y: m[1], pieces: [piece], params: { g: g.toFixed(1) } }); }
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
  const boxes = segs.map((s) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0 - MIN_SPACING, y0 - MIN_SPACING, x1 + MIN_SPACING, y1 + MIN_SPACING]; });
  const reported = new Set();
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j];
    if (A.piece === B.piece) continue;
    if (connected.has(key(A.piece, B.piece))) continue;
    const a = boxes[i], b = boxes[j];
    if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
    // najbliższa para próbek
    let best = null;
    for (const p of A.pts) for (const q of B.pts) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { d, p, q };
    }
    if (!best || best.d > MIN_SPACING) continue;
    const dz = Math.abs((best.p[2] || 0) - (best.q[2] || 0));
    const k = key(A.piece, B.piece);
    if (reported.has(k)) continue;
    const x = (best.p[0] + best.q[0]) / 2, y = (best.p[1] + best.q[1]) / 2;
    if (dz <= SAME_LEVEL && !polylinesCross(A.pts, B.pts) && sharedJointNear(A.piece, B.piece, x, y)) continue;
    if (dz > SAME_LEVEL) {
      if (dz < MIN_CLEARANCE && polylinesCross(A.pts, B.pts)) { reported.add(k); out.push({ type: 'clearance', x, y, pieces: [A.piece, B.piece], params: { dz: Math.round(dz), min: MIN_CLEARANCE } }); }
      continue;
    }
    reported.add(k);
    if (polylinesCross(A.pts, B.pts)) out.push({ type: 'collision', x, y, pieces: [A.piece, B.piece], params: {} });
    else out.push({ type: 'spacing', x, y, pieces: [A.piece, B.piece], params: { d: Math.round(best.d), min: MIN_SPACING } });
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
