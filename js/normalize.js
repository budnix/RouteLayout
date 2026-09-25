// Normalizacja odręcznej kreski do ciągu prymitywów (prosta / łuk) i ich
// dekompozycja na elementy PIKO.
//
// Etap 1 – geometria: krzywizna wzdłuż kreski → segmentacja na odcinki
// proste i łukowe → dopasowanie prostej / okręgu → snap promienia do R1–R4/R9,
// kąta łuku do siatki elementów, kierunku startu do 15°.
// Etap 2 – elementy: łuk = n × element o tym promieniu; prosta = optymalny
// zestaw prostych (DP: najmniejszy błąd długości i najmniej elementów).

import { BY_ID, R as RAD } from './catalog.js';
import { Layout, norm } from './layout.js';

const d2r = (d) => (d * Math.PI) / 180;
const r2d = (r) => (r * 180) / Math.PI;

const CURV_WIN = 7;              // ±7 próbek × 5 mm = okno 70 mm
const TAN_WIN = 8;               // wygładzanie stycznej ±8 próbek
const K_STRAIGHT = 1 / 2200;     // |krzywizna| poniżej → prosta (R > 2,2 m)
const K_CURVE = 1 / 1300;        // powyżej → łuk (histereza)
const MIN_SEG = 90;              // krótsze segmenty scalamy z sąsiadem [mm]
const MIN_STRAIGHT = 25;         // krótszą prostą pomijamy [mm]

// promienie katalogowe i elementy łukowe dla nich: [id, kąt]
const RADII = [
  { r: RAD.R1, pieces: [['55211', 30], ['55215', 7.5]] },
  { r: RAD.R2, pieces: [['55212', 30], ['55218', 7.5]] },
  { r: RAD.R3, pieces: [['55213', 30]] },
  { r: RAD.R4, pieces: [['55214', 30]] },
  { r: RAD.R9, pieces: [['55219', 15]] },
];
// proste do dekompozycji (bez przejściówek i flexa)
const STRAIGHT_PIECES = ['55200', '55201', '55202', '55203', '55204', '55205', '55206'].map((id) => [id, BY_ID[id].len]);
const TURNOUT_LEN = BY_ID['55220'].len ?? 239.07;

// ---- etap 1: prymitywy ---------------------------------------------------------

/**
 * @param {{pts:number[][], tan:number[]}} stroke wygładzona kreska (co 5 mm)
 * @param {number} step odstęp próbek [mm]
 * @returns prymitywy [{type:'line', i0,i1, a}, {type:'arc', i0,i1, r, dir, cx, cy}]
 */
export function segment(stroke, step = 5) {
  const { pts, tan } = stroke;
  const n = pts.length;
  if (n < 2 * CURV_WIN + 2) return [{ type: 'line', i0: 0, i1: n - 1, a: tan[0] }];
  // styczna rozwinięta (bez skoków ±180°) i wygładzona, potem krzywizna [rad/mm]
  const un = [tan[0]];
  for (let i = 1; i < n; i++) un.push(un[i - 1] + norm(tan[i] - tan[i - 1]));
  const sm = un.map((_, i) => { let a = 0, c = 0; for (let j = -TAN_WIN; j <= TAN_WIN; j++) { if (un[i + j] !== undefined) { a += un[i + j]; c++; } } return a / c; });
  const k = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - CURV_WIN), b = Math.min(n - 1, i + CURV_WIN);
    k[i] = d2r(sm[b] - sm[a]) / ((b - a) * step);
  }
  // klasyfikacja z histerezą: 0 prosta, +1 / -1 łuk
  const cls = new Array(n).fill(0);
  let state = 0;
  for (let i = 0; i < n; i++) {
    const ak = Math.abs(k[i]);
    if (state === 0 && ak > K_CURVE) state = Math.sign(k[i]);
    else if (state !== 0 && (ak < K_STRAIGHT || Math.sign(k[i]) !== state)) state = ak > K_CURVE ? Math.sign(k[i]) : 0;
    cls[i] = state;
  }
  // segmenty ciągłe
  let segs = [];
  let s = 0;
  for (let i = 1; i <= n; i++) if (i === n || cls[i] !== cls[s]) { segs.push({ c: cls[s], i0: s, i1: i - 1 }); s = i; }
  // scalanie krótkich segmentów z dłuższym sąsiadem
  const len = (g) => (g.i1 - g.i0) * step;
  let changed = true;
  while (changed && segs.length > 1) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      if (len(segs[i]) >= MIN_SEG) continue;
      const prev = segs[i - 1], next = segs[i + 1];
      const into = !prev ? next : !next ? prev : (len(prev) >= len(next) ? prev : next);
      into.i0 = Math.min(into.i0, segs[i].i0); into.i1 = Math.max(into.i1, segs[i].i1);
      segs.splice(i, 1); changed = true; break;
    }
    // sąsiedzi tej samej klasy → scal
    for (let i = 0; i + 1 < segs.length; i++) if (segs[i].c === segs[i + 1].c) { segs[i].i1 = segs[i + 1].i1; segs.splice(i + 1, 1); changed = true; break; }
  }
  // dopasowanie geometrii
  let prims = segs.map((g) => fitPrim(pts, g.i0, g.i1, g.c));
  // dopracowanie granic: przesuń granicę tam, gdzie suma reszt do obu modeli jest najmniejsza
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i + 1 < prims.length; i++) {
      const A = prims[i], B = prims[i + 1];
      const lo = A.i0 + 4, hi = B.i1 - 4;
      if (hi <= lo) continue;
      let best = A.i1, bestCost = Infinity;
      if (A.type !== B.type) {
        // prosta i łuk są styczne: granica w spodku prostopadłej ze środka okręgu na prostą
        const line = A.type === 'line' ? A : B, arc = A.type === 'arc' ? A : B;
        const ux = Math.cos(d2r(line.a)), uy = Math.sin(d2r(line.a));
        const t = (arc.cx - line.mx) * ux + (arc.cy - line.my) * uy;
        const fx = line.mx + ux * t, fy = line.my + uy * t;
        let bd = Infinity;
        for (let j = lo; j <= hi; j++) { const d = Math.hypot(pts[j][0] - fx, pts[j][1] - fy); if (d < bd) { bd = d; best = j; } }
        A.i1 = best; B.i0 = best + 1;
        continue;
      }
      // koszt(j) = Σ_{lo..j} resid_A + Σ_{j+1..hi} resid_B  (prefiksy)
      const ra = [], rb = [];
      for (let j = lo; j <= hi; j++) { ra.push(resid(A, pts[j])); rb.push(resid(B, pts[j])); }
      const sufB = new Array(rb.length + 1).fill(0);
      for (let j = rb.length - 1; j >= 0; j--) sufB[j] = sufB[j + 1] + rb[j];
      let preA = 0;
      for (let j = 0; j < ra.length; j++) { preA += ra[j]; const c = preA + sufB[j + 1]; if (c < bestCost) { bestCost = c; best = lo + j; } }
      A.i1 = best; B.i0 = best + 1;
    }
    prims = prims.map((p) => fitPrim(pts, p.i0, p.i1, p.type === 'arc' ? p.dir : 0));
    prims = mergePrims(pts, prims, step);
  }
  return prims;
}

/** Scala prymitywy krótsze niż MIN_SEG z dłuższym sąsiadem oraz sąsiadów tego samego typu i kierunku. */
function mergePrims(pts, prims, step) {
  const len = (p) => (p.i1 - p.i0) * step;
  const refit = (p) => fitPrim(pts, p.i0, p.i1, p.type === 'arc' ? p.dir : 0);
  let changed = true;
  while (changed && prims.length > 1) {
    changed = false;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i], prev = prims[i - 1], next = prims[i + 1];
      const same = (q) => q && q.type === p.type && (p.type === 'line' ? Math.abs(norm(q.a - p.a)) < 12 : q.dir === p.dir);
      let into = null;
      if (same(prev)) into = prev; else if (same(next)) into = next;
      else if (len(p) < MIN_SEG) into = !prev ? next : !next ? prev : (len(prev) >= len(next) ? prev : next);
      if (!into) continue;
      into.i0 = Math.min(into.i0, p.i0); into.i1 = Math.max(into.i1, p.i1);
      prims.splice(i, 1);
      prims[prims.indexOf(into)] = refit(into);
      changed = true; break;
    }
  }
  return prims;
}

function fitPrim(pts, i0, i1, c) {
  const P = pts.slice(i0, i1 + 1);
  if (c === 0 || P.length < 5) return { type: 'line', i0, i1, ...lineModel(P) };
  const circ = circleFit(P);
  if (!circ || circ.r > 1800) return { type: 'line', i0, i1, ...lineModel(P) };
  return { type: 'arc', i0, i1, r: circ.r, cx: circ.cx, cy: circ.cy, dir: c };
}

function lineModel(P) {
  let mx = 0, my = 0; for (const [x, y] of P) { mx += x; my += y; } mx /= P.length; my /= P.length;
  return { a: lineFit(P), mx, my };
}

/** Reszta punktu względem modelu prymitywu [mm]. */
function resid(p, pt) {
  if (p.type === 'arc') return Math.abs(Math.hypot(pt[0] - p.cx, pt[1] - p.cy) - p.r);
  const nx = -Math.sin(d2r(p.a)), ny = Math.cos(d2r(p.a));
  return Math.abs((pt[0] - p.mx) * nx + (pt[1] - p.my) * ny);
}

/** Kierunek prostej metodą najmniejszych kwadratów (PCA). */
function lineFit(P) {
  const n = P.length;
  let mx = 0, my = 0; for (const [x, y] of P) { mx += x; my += y; } mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of P) { const dx = x - mx, dy = y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  let a = r2d(0.5 * Math.atan2(2 * sxy, sxx - syy));
  // orientacja zgodna z kierunkiem rysowania
  const [x0, y0] = P[0], [x1, y1] = P[n - 1];
  if (Math.cos(d2r(a)) * (x1 - x0) + Math.sin(d2r(a)) * (y1 - y0) < 0) a += 180;
  return norm(a);
}

/** Algebraiczne dopasowanie okręgu (Kåsa). */
function circleFit(P) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = P.length;
  for (const [x, y] of P) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  // [sxx sxy sx; sxy syy sy; sx sy n] · [D E F]ᵀ = -[sxz syz sz]ᵀ
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [-sxz, -syz, -sz];
  const sol = solve3(M, v);
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2, cy = -E / 2, r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  return { cx, cy, r: Math.sqrt(r2) };
}

function solve3(M, v) {
  const A = M.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((row, i) => row[3] / row[i]);
}

// ---- snap ---------------------------------------------------------------------

function snapRadius(r) {
  let best = RADII[0];
  for (const c of RADII) if (Math.abs(Math.log(r / c.r)) < Math.abs(Math.log(r / best.r))) best = c;
  return best;
}

/** Kąt łuku do siatki elementów danego promienia (najmniejszy dostępny kąt jako krok). */
function snapSweep(sweep, radius) {
  const unit = Math.min(...radius.pieces.map(([, a]) => a));
  const snapped = Math.round(sweep / unit) * unit;
  return Math.max(unit, snapped);
}

// ---- budowa ścieżki idealnej -------------------------------------------------------

/**
 * Z prymitywów i pozy startowej buduje ciąg { type:'straight', L } / { type:'arc', radius, sweep, dir }.
 * Długości prostych dobierane tak, by kolejny prymityw zaczynał się w miejscu narysowanym.
 */
export function idealPath(stroke, prims, startPose, snapStart = true) {
  const pts = stroke.pts;
  let pose = { ...startPose };
  if (snapStart && prims.length) {
    // kierunek startu z dopasowanej prostej (odporny na szum), inaczej średnia stycznych z początku
    let a0 = prims[0].a;
    if (prims[0].type !== 'line') { let sx = 0, sy = 0; for (let j = 0; j < Math.min(10, stroke.tan.length); j++) { sx += Math.cos(d2r(stroke.tan[j])); sy += Math.sin(d2r(stroke.tan[j])); } a0 = r2d(Math.atan2(sy, sx)); }
    pose.a = norm(Math.round(a0 / 15) * 15);
  }
  const start = { ...pose };
  const out = [];
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    if (p.type === 'line') {
      // koniec prostej: początek kolejnego prymitywu (lub koniec kreski) rzutowany na kierunek
      const target = pts[i + 1 < prims.length ? prims[i + 1].i0 : p.i1];
      const L = (target[0] - pose.x) * Math.cos(d2r(pose.a)) + (target[1] - pose.y) * Math.sin(d2r(pose.a));
      if (L < MIN_STRAIGHT) continue;
      out.push({ type: 'straight', L });
      pose = { x: pose.x + L * Math.cos(d2r(pose.a)), y: pose.y + L * Math.sin(d2r(pose.a)), a: pose.a };
    } else {
      const radius = snapRadius(p.r);
      const sweep = snapSweep(arcSweep(stroke, prims, i), radius);
      out.push({ type: 'arc', radius, sweep, dir: p.dir });
      const dir = p.dir;
      const cx = pose.x - dir * radius.r * Math.sin(d2r(pose.a)), cy = pose.y + dir * radius.r * Math.cos(d2r(pose.a));
      const a0 = pose.a - dir * 90, a1 = a0 + dir * sweep;
      pose = { x: cx + radius.r * Math.cos(d2r(a1)), y: cy + radius.r * Math.sin(d2r(a1)), a: norm(pose.a + dir * sweep) };
    }
  }
  return { path: out, start, end: pose };
}

/**
 * Kąt łuku [°]. Gdy łuk leży między dwiema prostymi, najpewniejsza jest różnica
 * ich kierunków; inaczej suma zmian stycznej wewnątrz segmentu (działa > 180°).
 */
function arcSweep(stroke, prims, i) {
  const p = prims[i], prev = prims[i - 1], next = prims[i + 1];
  let acc = 0;
  for (let j = Math.max(0, p.i0 - 2); j < Math.min(stroke.tan.length - 1, p.i1 + 2); j++) acc += norm(stroke.tan[j + 1] - stroke.tan[j]);
  acc = Math.abs(acc);
  if (prev?.type === 'line' && next?.type === 'line') {
    const d = Math.abs(norm(next.a - prev.a));
    return acc > 180 ? 360 - d : d;
  }
  // z wektorów promieni od środka dopasowanego okręgu (odporne na szum stycznej)
  const [x0, y0] = stroke.pts[p.i0], [x1, y1] = stroke.pts[p.i1];
  const a0 = r2d(Math.atan2(y0 - p.cy, x0 - p.cx)), a1 = r2d(Math.atan2(y1 - p.cy, x1 - p.cx));
  let sw = ((a1 - a0) * p.dir) % 360; if (sw < 0) sw += 360;
  if (acc < 90 && sw > 270) sw = 360 - sw;   // niejednoznaczność przy bardzo małych łukach
  return sw;
}

// ---- etap 2: elementy ----------------------------------------------------------------

/** Optymalny zestaw prostych o sumie ≈ L (DP po długości w mm). */
export function decomposeStraight(L, piecePenalty = 8) {
  const target = Math.round(L);
  if (target < 20) return [];
  const maxLen = target + 70;
  const INF = 1e9;
  const cost = new Float64Array(maxLen + 1).fill(INF); cost[0] = 0;
  const from = new Int32Array(maxLen + 1).fill(-1);
  for (let l = 1; l <= maxLen; l++) {
    for (let k = 0; k < STRAIGHT_PIECES.length; k++) {
      const pl = Math.round(STRAIGHT_PIECES[k][1]);
      if (pl <= l && cost[l - pl] + 1 < cost[l]) { cost[l] = cost[l - pl] + 1; from[l] = k; }
    }
  }
  // wybór sumy: błąd długości + 4 mm za każdy element
  let best = -1, bestScore = INF;
  for (let l = Math.max(1, target - 70); l <= maxLen; l++) {
    if (cost[l] >= INF) continue;
    const score = Math.abs(l - target) + piecePenalty * cost[l];
    if (score < bestScore) { bestScore = score; best = l; }
  }
  const ids = [];
  for (let l = best; l > 0; l -= Math.round(STRAIGHT_PIECES[from[l]][1])) ids.push(STRAIGHT_PIECES[from[l]][0]);
  return ids.sort((a, b) => BY_ID[b].len - BY_ID[a].len);
}

/** Elementy łuku: największe kąty najpierw. */
export function decomposeArc(radius, sweep) {
  const ids = [];
  let rest = sweep + 1e-6;
  for (const [id, ang] of [...radius.pieces].sort((a, b) => b[1] - a[1])) {
    while (rest >= ang - 1e-6) { ids.push(id); rest -= ang; }
  }
  return ids;
}

/**
 * Zamienia ścieżkę idealną na listę elementów { id, entry }; pozycje liczy
 * wywołujący, doklejając je kolejno od pozy startowej.
 */
export function pathToPieces(path, freeEnd = false) {
  const out = [];
  for (const [i, p] of path.entries()) {
    if (p.type === 'straight') for (const id of decomposeStraight(p.L, freeEnd && i === path.length - 1 ? 25 : 8)) out.push({ id, entry: 0 });
    else for (const id of decomposeArc(p.radius, p.sweep)) out.push({ id, entry: p.dir > 0 ? 0 : 1 });
  }
  return out;
}

/** Doklejanie listy { id, entry } od pozy; zwraca elementy z pozycjami i pozę końcową. */
export function chain(list, startPose) {
  let pose = { ...startPose };
  const pieces = [];
  for (const { id, entry } of list) {
    const p = Layout.poseFor(id, entry, { x: pose.x, y: pose.y, a: pose.a });
    const piece = { id, x: p.x, y: p.y, rot: p.rot, z: startPose.z || 0 };
    pieces.push(piece);
    const exitIdx = BY_ID[id].group === 'turnout' ? (entry === 0 ? 1 : 0) : (entry === 0 ? 1 : 0);
    const e = Layout.worldPort(piece, exitIdx);
    pose = { x: e.x, y: e.y, a: e.a };
  }
  return { pieces, end: pose };
}

export { TURNOUT_LEN, RADII };
