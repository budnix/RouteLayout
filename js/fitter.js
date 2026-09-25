// Zamiana odręcznych kresek na tory PIKO.
//
// Wejście: lista kresek (tablice punktów [x,y] w mm) + istniejący układ.
// Wyjście: lista elementów { id, x, y, rot } do dodania.
//
// Algorytm: każdą kreskę wygładzamy i próbkujemy co STEP mm. Potem od pozy
// startowej dokładamy zachłannie kolejne elementy, wybierając ten, którego
// próbki leżą najbliżej kreski, a kierunek na końcu zgadza się ze styczną
// kreski (z podglądem o jeden krok – "beam" szerokości K). Jeśli inna kreska
// zaczyna się obok bieżącej pozy, kandydatem staje się rozjazd WL/WR, a tamta
// kreska jest dalej dopasowywana od portu odgałęzienia.

import { BY_ID, geoOf, sampleSegment } from './catalog.js';
import { Layout, norm } from './layout.js';
import { segment, idealPath, pathToPieces, chain, decomposeStraight, TURNOUT_LEN } from './normalize.js';

const STEP = 5;                 // próbkowanie kreski [mm]
const MIN_STROKE = 60;          // krótsze kreski ignorujemy [mm]
const ATTACH_DIST = 45;         // doczepianie do otwartego portu [mm]
const ATTACH_ANG = 50;          // ... i maks. różnica kąta [°]
const BRANCH_DIST = 40;         // odgałęzienie: port rozjazdu blisko startu kreski [mm]
const BRANCH_ANG = 40;
const MAX_MEAN = 70;            // gdy najlepszy kandydat odstaje bardziej – przerwij kreskę
const BEAM = 3;

// kandydaci: [id, port wejściowy]; łuk portem 1 = skręt w drugą stronę
const STRAIGHTS = [['55200', 0], ['55201', 0], ['55202', 0], ['55205', 0]];
const CURVES = ['55211', '55212', '55213', '55214', '55219', '55218', '55215'].flatMap((id) => [[id, 0], [id, 1]]);
const TURNOUTS = ['55220', '55221'].flatMap((id) => [[id, 0], [id, 1]]);
const PENALTY = { '55205': 14, '55202': 5, '55215': 12, '55218': 10, '55211': 3, '55220': 6, '55221': 6 };

const d2r = (d) => (d * Math.PI) / 180;
const r2d = (r) => (r * 180) / Math.PI;

// ---- przygotowanie kreski ---------------------------------------------------

/** Wygładza i próbkuje kreskę. Zwraca { pts, tan, len } lub null gdy za krótka. */
export function prepareStroke(raw, step = STEP) {
  if (!(step > 0)) step = STEP;
  let pts = raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 0.5);
  if (pts.length < 2) return null;
  pts = resample(pts, step);
  for (let k = 0; k < 3; k++) pts = smooth(pts, 3);
  pts = resample(pts, step);
  if (pts.length < 3) return null;
  const len = (pts.length - 1) * step;
  if (len < MIN_STROKE) return null;
  const tan = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 3)], b = pts[Math.min(pts.length - 1, i + 3)];
    return r2d(Math.atan2(b[1] - a[1], b[0] - a[0]));
  });
  return { pts, tan, len };
}

function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (carry + seg >= step) {
      const t = (step - carry) / seg;
      x0 += (x1 - x0) * t; y0 += (y1 - y0) * t;
      out.push([x0, y0]);
      seg = Math.hypot(x1 - x0, y1 - y0); carry = 0;
    }
    carry += seg;
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > step / 2) out.push(last);
  return out;
}

function smooth(pts, w) {
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let k = -w; k <= w; k++) { const p = pts[i + k]; if (p) { sx += p[0]; sy += p[1]; n++; } }
    return [sx / n, sy / n];
  });
}

/** Najbliższy punkt kreski do (x,y) w oknie indeksów wokół from. */
function nearest(stroke, x, y, from, back = 15, ahead = 120) {
  const pts = stroke.pts;
  let best = Infinity, bi = from;
  for (let i = Math.max(0, from - back); i < Math.min(pts.length, from + ahead); i++) {
    const d = Math.hypot(pts[i][0] - x, pts[i][1] - y);
    if (d < best) { best = d; bi = i; }
  }
  return { d: best, idx: bi };
}

// ---- ocena kandydata ----------------------------------------------------------

function place(id, entry, pose) {
  const p = Layout.poseFor(id, entry, { x: pose.x, y: pose.y, a: pose.a });
  return { id, x: p.x, y: p.y, rot: p.rot };
}

/** Ocena elementu id wstawionego portem entry w pozie pose; ocenia przejazd "na wprost". */
function evaluate(stroke, pose, id, entry, sIdx) {
  const def = BY_ID[id];
  const piece = place(id, entry, pose);
  const segs = def.group === 'turnout' ? [def.geo.segments[0]] : def.geo.segments;
  let sum = 0, max = 0, n = 0, idx = sIdx;
  for (const seg of segs) {
    for (const [lx, ly] of sampleSegment(seg, 8)) {
      const w = Layout.localToWorld(piece, lx, ly);
      const r = nearest(stroke, w.x, w.y, idx);
      idx = Math.max(idx, r.idx);
      sum += r.d; max = Math.max(max, r.d); n++;
    }
  }
  const exit = Layout.worldPort(piece, entry === 0 ? 1 : 0);
  const end = nearest(stroke, exit.x, exit.y, sIdx);
  const last = stroke.pts.length - 1;
  const dAng = Math.abs(norm(exit.a - stroke.tan[end.idx]));
  let score = sum / n + 0.3 * max + 0.5 * dAng + (PENALTY[id] || 0);
  // spójny promień: ten sam łuk w tym samym kierunku co poprzednio – premia
  if (pose.prev && pose.prev.id === id && pose.prev.entry === entry && def.group === 'curve') score -= 5;
  if (end.idx <= sIdx + 1) score += 200;                       // brak postępu
  if (end.idx >= last - 1) {                                    // wystaje poza koniec kreski
    const over = Math.hypot(exit.x - stroke.pts[last][0], exit.y - stroke.pts[last][1]);
    score += over * 0.35;
  }
  return { piece, next: { x: exit.x, y: exit.y, a: exit.a, prev: { id, entry } }, idx: end.idx, score, mean: sum / n };
}

// ---- dopasowanie -----------------------------------------------------------------

/**
 * @param {number[][][]} rawStrokes kreski w mm
 * @param {Layout} layout istniejący układ (do doczepiania)
 * @returns {{ pieces: object[], strokesUsed: number }}
 */
export function fitGreedy(rawStrokes, layout) {
  const strokes = rawStrokes.map((r) => prepareStroke(r)).filter(Boolean).map((s) => ({ ...s, done: false, start: null }));
  strokes.sort((a, b) => b.len - a.len);
  const pieces = [];
  let openPorts = layout ? layout.openPorts().map((p) => ({ x: p.x, y: p.y, a: p.a })) : [];

  const addPiece = (piece) => {
    pieces.push(piece);
    const n = geoOf(piece).ports.length;
    for (let i = 0; i < n; i++) openPorts.push(Layout.worldPort(piece, i));
  };
  const removeOpenNear = (x, y) => { openPorts = openPorts.filter((p) => Math.hypot(p.x - x, p.y - y) > 1); };

  for (const stroke of strokes) {
    if (stroke.done) continue;
    stroke.done = true;
    let pose, sIdx = 0;

    if (stroke.start) {
      ({ pose } = stroke.start);
      sIdx = nearest(stroke, pose.x, pose.y, 0, 0, 40).idx;
    } else {
      // doczep do otwartego portu (początek lub – po odwróceniu – koniec kreski)
      const att = findAttach(stroke, openPorts);
      if (att) {
        if (att.reverse) reverseStroke(stroke);
        pose = { x: att.port.x, y: att.port.y, a: att.port.a };
        removeOpenNear(pose.x, pose.y);
        sIdx = nearest(stroke, pose.x, pose.y, 0, 0, 40).idx;
      } else {
        pose = { x: stroke.pts[0][0], y: stroke.pts[0][1], a: stroke.tan[0] };
      }
    }

    const last = stroke.pts.length - 1;
    let guard = 0;
    while (sIdx < last - 3 && guard++ < 400) {
      const cands = candidates(stroke, pose, sIdx, strokes, openPorts);
      if (!cands.length) break;
      cands.sort((a, b) => a.score - b.score);
      // beam: dla najlepszych K policz najlepszego następcę
      let best = null;
      for (const c of cands.slice(0, BEAM)) {
        let child = 0;
        if (c.idx < last - 3) {
          const nx = candidates(stroke, c.next, c.idx, strokes, openPorts);
          child = nx.length ? Math.min(...nx.map((k) => k.score)) : 0;
        }
        const total = c.score + 0.6 * child;
        if (!best || total < best.total) best = { ...c, total };
      }
      if (best.mean > MAX_MEAN) break;
      addPiece(best.piece);
      removeOpenNear(pose.x, pose.y);
      if (best.branch) {
        const b = best.branch;
        b.stroke.start = { pose: b.pose };
        if (b.reverse) reverseStroke(b.stroke);
        removeOpenNear(b.pose.x, b.pose.y);
      }
      pose = best.next; sIdx = best.idx;
    }
  }
  return { pieces, strokesUsed: strokes.length };
}

function reverseStroke(s) {
  s.pts.reverse();
  s.tan = s.tan.reverse().map((a) => norm(a + 180));
}

function findAttach(stroke, ports) {
  let best = null;
  for (const port of ports) {
    for (const [pt, tan, reverse] of [[stroke.pts[0], stroke.tan[0], false], [stroke.pts[stroke.pts.length - 1], norm(stroke.tan[stroke.tan.length - 1] + 180), true]]) {
      const d = Math.hypot(port.x - pt[0], port.y - pt[1]);
      if (d > ATTACH_DIST || Math.abs(norm(port.a - tan)) > ATTACH_ANG) continue;
      if (!best || d < best.d) best = { d, port, reverse };
    }
  }
  return best;
}

/** Kandydaci w danej pozie; z rozjazdami, gdy inna kreska zaczyna się obok. */
function candidates(stroke, pose, sIdx, strokes, openPorts) {
  const out = [];
  for (const [id, entry] of [...STRAIGHTS, ...CURVES]) out.push(evaluate(stroke, pose, id, entry, sIdx));
  // kreski, które mogłyby być odgałęzieniem w pobliżu
  const near = strokes.filter((s) => s !== stroke && !s.done && !s.start && (dist(s.pts[0], pose) < 320 || dist(s.pts[s.pts.length - 1], pose) < 320));
  if (!near.length) return out;
  for (const [id, entry] of TURNOUTS) {
    const ev = evaluate(stroke, pose, id, entry, sIdx);
    const branchPort = Layout.worldPort(ev.piece, 2);
    let match = null;
    for (const s of near) {
      const m = matchBranch(s, branchPort);
      if (m && (!match || m.d < match.d)) match = m;
    }
    if (!match) continue;
    ev.score -= 25 - match.d * 0.3;         // premia za obsłużenie odgałęzienia
    ev.branch = match;
    out.push(ev);
  }
  return out;
}

/**
 * Czy port odgałęzienia leży na początkowym (lub końcowym – wtedy kreska
 * zostanie odwrócona) odcinku kreski s, z pasującym kierunkiem?
 */
function matchBranch(s, port) {
  const n = s.pts.length, win = Math.min(n, 70);   // ~350 mm
  let best = null;
  for (let i = 0; i < win; i++) {
    const d = Math.hypot(s.pts[i][0] - port.x, s.pts[i][1] - port.y);
    const da = Math.abs(norm(s.tan[i] - port.a));
    if (d < BRANCH_DIST && da < BRANCH_ANG && (!best || d < best.d)) best = { d, da, stroke: s, reverse: false, pose: { x: port.x, y: port.y, a: port.a } };
    const j = n - 1 - i;
    const dj = Math.hypot(s.pts[j][0] - port.x, s.pts[j][1] - port.y);
    const daj = Math.abs(norm(s.tan[j] + 180 - port.a));
    if (dj < BRANCH_DIST && daj < BRANCH_ANG && (!best || dj < best.d)) best = { d: dj, da: daj, stroke: s, reverse: true, pose: { x: port.x, y: port.y, a: port.a } };
  }
  return best;
}

const dist = (pt, pose) => Math.hypot(pt[0] - pose.x, pt[1] - pose.y);

/** Do testów: średnia odległość próbek elementów od kreski. */
export function deviation(pieces, raw) {
  const stroke = prepareStroke(raw);
  let sum = 0, n = 0;
  for (const piece of pieces) for (const seg of BY_ID[piece.id].geo.segments) for (const [lx, ly] of sampleSegment(seg, 10)) {
    const w = Layout.localToWorld(piece, lx, ly);
    let best = Infinity;
    for (const p of stroke.pts) best = Math.min(best, Math.hypot(p[0] - w.x, p[1] - w.y));
    sum += best; n++;
  }
  return sum / n;
}


// ============================================================================
// Wariant znormalizowany: kreska → prymitywy → ścieżka idealna → elementy.
// ============================================================================

const BRANCH_SCAN = 10;   // krok skanowania położenia ostrza rozjazdu wzdłuż prostej [mm]

function subStroke(stroke, from) {
  return { pts: stroke.pts.slice(from), tan: stroke.tan.slice(from), len: (stroke.pts.length - 1 - from) * STEP };
}

/** Kreski-odgałęzienia: początek (lub koniec) B leży na wnętrzu A. */
function findParents(strokes) {
  for (const b of strokes) {
    b.parent = null;
    for (const a of strokes) {
      if (a === b) continue;
      const margin = 12; // pomiń 60 mm przy końcach A
      for (const [pt] of [[b.pts[0]], [b.pts[b.pts.length - 1]]]) {
        for (let i = margin; i < a.pts.length - margin; i++) {
          if (Math.hypot(a.pts[i][0] - pt[0], a.pts[i][1] - pt[1]) < BRANCH_DIST) { b.parent = a; break; }
        }
        if (b.parent) break;
      }
      if (b.parent) break;
    }
  }
  // kolejność: rodzice przed dziećmi, dłuższe najpierw
  const ordered = [];
  const visit = (s) => { if (ordered.includes(s)) return; if (s.parent && !ordered.includes(s.parent)) visit(s.parent); ordered.push(s); };
  for (const s of [...strokes].sort((a, b) => b.len - a.len)) visit(s);
  return ordered;
}

/**
 * Prosta o długości L od pozy: jeśli któraś nienaruszona kreska odgałęzia się
 * z niej, wstaw rozjazd (skanując położenie ostrza) i ustaw start tej kreski.
 * Zwraca listę { id, entry }.
 */
function straightWithTurnouts(L, pose, strokes, freeStart = false, freeEnd = false) {
  const list = [];
  let restL = L, cur = { ...pose };
  for (let guard = 0; guard < 6; guard++) {
    const near = strokes.filter((s) => !s.done && !s.start && (dist(s.pts[0], cur) < L + 400 || dist(s.pts[s.pts.length - 1], cur) < L + 400));
    let best = null;
    if (near.length && restL >= TURNOUT_LEN) {
      for (let t = 0; t <= restL - TURNOUT_LEN + 1e-6; t += BRANCH_SCAN) {
        const toe = { x: cur.x + t * Math.cos(d2r(cur.a)), y: cur.y + t * Math.sin(d2r(cur.a)), a: cur.a };
        for (const [id, entry] of TURNOUTS) {
          const piece = place(id, entry, toe);
          const port = Layout.worldPort(piece, 2);
          for (const s of near) {
            const m = matchBranch(s, port);
            if (!m) continue;
            const ids = decomposeStraight(t);
            const err = Math.abs(ids.reduce((a, i) => a + BY_ID[i].len, 0) - t);
            const cost = m.d + 1.5 * m.da + 4 * ids.length + 2 * err;
            if (!best || cost < best.cost) best = { cost, d: m.d, t, id, entry, match: m };
          }
        }
      }
    }
    if (!best) break;
    if (freeStart && guard === 0) {
      // początek kreski nie jest przypięty: przesuń go tak, by przed ostrzem były tylko całe G239
      const n = Math.round(best.t / G239);
      const shift = best.t - n * G239;
      pose = { x: pose.x + shift * Math.cos(d2r(pose.a)), y: pose.y + shift * Math.sin(d2r(pose.a)), a: pose.a };
      L -= shift; restL = L; best.t = n * G239;
    }
    // prosta przed ostrzem, rozjazd, dalej reszta
    for (const id of decomposeStraight(best.t)) list.push({ id, entry: 0 });
    list.push({ id: best.id, entry: best.entry });
    // rzeczywista długość dodanych prostych różni się od t – pozę i port odgałęzienia bierz z łańcucha
    const c = chain(list, pose);
    cur = c.end; restL = L - projLen(pose, cur);
    const turnout = c.pieces[c.pieces.length - 1];
    const port = Layout.worldPort(turnout, 2);
    const b = best.match;
    b.stroke.start = { pose: { x: port.x, y: port.y, a: port.a } };
    if (b.reverse) reverseStroke(b.stroke);
    if (restL < 20) return list;
  }
  // wolny koniec kreski: mniej elementów ważniejsze niż dokładna długość
  for (const id of decomposeStraight(restL, freeEnd ? 25 : 8)) list.push({ id, entry: 0 });
  return { list, pose };
}

const G239 = BY_ID['55200'].len;

const projLen = (from, to) => (to.x - from.x) * Math.cos(d2r(from.a)) + (to.y - from.y) * Math.sin(d2r(from.a));

export function fitNormalized(rawStrokes, layout) {
  const strokes = rawStrokes.map((r) => prepareStroke(r)).filter(Boolean).map((s) => ({ ...s, done: false, start: null }));
  const ordered = findParents(strokes);
  const pieces = [];
  let openPorts = layout ? layout.openPorts().map((p) => ({ x: p.x, y: p.y, a: p.a })) : [];

  for (const stroke of ordered) {
    if (stroke.done) continue;
    stroke.done = true;
    let pose, from = 0, snapStart = true;
    if (stroke.start) {
      pose = stroke.start.pose; snapStart = false;
      from = nearest(stroke, pose.x, pose.y, 0, 0, 60).idx;
    } else {
      const att = findAttach(stroke, openPorts);
      if (att) {
        if (att.reverse) reverseStroke(stroke);
        pose = { x: att.port.x, y: att.port.y, a: att.port.a, z: att.port.z || 0 }; snapStart = false;
        from = nearest(stroke, pose.x, pose.y, 0, 0, 60).idx;
        openPorts = openPorts.filter((p) => Math.hypot(p.x - pose.x, p.y - pose.y) > 1);
      } else {
        pose = { x: stroke.pts[0][0], y: stroke.pts[0][1], a: stroke.tan[0] };
      }
    }
    const sub = from > 0 ? subStroke(stroke, from) : stroke;
    if (sub.pts.length < 4) continue;
    const prims = segment(sub);
    const { path, start } = idealPath(sub, prims, pose, snapStart);
    pose = start;
    // elementy: proste z rozjazdami, łuki wprost
    const list = [];
    let cur = { ...pose };
    for (const [pi, p] of path.entries()) {
      let part;
      if (p.type === 'straight') {
        const r = straightWithTurnouts(p.L, cur, strokes, snapStart && list.length === 0, pi === path.length - 1);
        part = r.list; if (list.length === 0) pose = r.pose; cur = r.pose;
      } else part = pathToPieces([p]);
      const c = chain(part, cur);
      list.push(...part); cur = c.end;
    }
    const built = chain(list, pose).pieces;
    for (const b of built) b.z = pose.z || 0;
    pieces.push(...built);
    for (const piece of built) for (let i = 0; i < geoOf(piece).ports.length; i++) openPorts.push(Layout.worldPort(piece, i));
  }
  return { pieces, strokesUsed: strokes.length };
}

/**
 * Główne wejście. Normalizacja daje "czystą" geometrię (promienie i kąty z
 * katalogu), więc jej odchylenie od kreski jest z założenia większe – to cena
 * snapu, nie błąd. Zachłanne dopasowanie bierzemy tylko wtedy, gdy
 * normalizacja wyraźnie odstaje od tego, co narysowano.
 */
export function fitStrokes(rawStrokes, layout, { normalize = true } = {}) {
  if (!normalize) {
    // "dosłownie": tor ma podążać za kreską tak, jak ją narysowano
    const g = fitGreedy(rawStrokes, layout);
    return { ...g, method: 'greedy', deviation: meanDeviation(g.pieces, rawStrokes) };
  }
  const a = fitNormalized(rawStrokes, layout);
  const da = meanDeviation(a.pieces, rawStrokes);
  if (a.pieces.length && da.mean < 40 && da.max < 110) return { ...a, method: 'normalized', deviation: da };
  const b = fitGreedy(rawStrokes, layout);
  const db = meanDeviation(b.pieces, rawStrokes);
  const sa = da.mean + 3 * a.pieces.length, sb = db.mean + 3 * b.pieces.length;
  return sa <= sb && a.pieces.length ? { ...a, method: 'normalized', deviation: da } : { ...b, method: 'greedy', deviation: db };
}

function meanDeviation(pieces, rawStrokes) {
  if (!pieces.length) return { mean: Infinity, max: Infinity };
  const strokes = rawStrokes.map((r) => prepareStroke(r)).filter(Boolean);
  let sum = 0, n = 0, max = 0;
  for (const piece of pieces) for (const seg of BY_ID[piece.id].geo.segments) for (const [lx, ly] of sampleSegment(seg, 15)) {
    const w = Layout.localToWorld(piece, lx, ly);
    let best = Infinity;
    for (const s of strokes) for (const p of s.pts) { const d = Math.hypot(p[0] - w.x, p[1] - w.y); if (d < best) best = d; }
    sum += best; n++; max = Math.max(max, best);
  }
  return { mean: sum / n, max };
}


// ============================================================================
// Normalizacja "na żywo": kreska → łamana ze ścieżki idealnej (proste + łuki
// o promieniach PIKO), używana przez edytor po każdym puszczeniu palca.
// ============================================================================

/**
 * @param {number[][]} raw punkty kreski [x,y] w mm
 * @param {Layout} layout istniejący układ (doczepianie do otwartych końców)
 * @returns {number[][]|null} znormalizowane punkty lub null, gdy kreska za krótka
 */
export function normalizeStroke(raw, layout) {
  const stroke = prepareStroke(raw);
  if (!stroke) return null;
  const openPorts = layout ? layout.openPorts().map((p) => ({ x: p.x, y: p.y, a: p.a })) : [];
  let pose, from = 0, snapStart = true;
  const att = findAttach(stroke, openPorts);
  if (att) {
    if (att.reverse) reverseStroke(stroke);
    pose = { x: att.port.x, y: att.port.y, a: att.port.a }; snapStart = false;
    from = nearest(stroke, pose.x, pose.y, 0, 0, 60).idx;
  } else {
    pose = { x: stroke.pts[0][0], y: stroke.pts[0][1], a: stroke.tan[0] };
  }
  const sub = from > 0 ? subStroke(stroke, from) : stroke;
  if (sub.pts.length < 4) return null;
  const { path, start } = idealPath(sub, segment(sub), pose, snapStart);
  if (!path.length) return null;
  const pts = pathToPoints(path, start);
  // kreska odwrócona (doczepiona końcem) – oddaj w kierunku rysowania
  return att?.reverse ? pts.reverse() : pts;
}

/** Łamana wzdłuż ścieżki idealnej: proste jako odcinki, łuki próbkowane co ~5°. */
export function pathToPoints(path, start) {
  let pose = { ...start };
  const out = [[pose.x, pose.y]];
  for (const p of path) {
    if (p.type === 'straight') {
      pose = { x: pose.x + p.L * Math.cos(d2r(pose.a)), y: pose.y + p.L * Math.sin(d2r(pose.a)), a: pose.a };
      out.push([pose.x, pose.y]);
    } else {
      const r = p.radius.r, dir = p.dir;
      const cx = pose.x - dir * r * Math.sin(d2r(pose.a)), cy = pose.y + dir * r * Math.cos(d2r(pose.a));
      const a0 = pose.a - dir * 90;
      const n = Math.max(2, Math.ceil(p.sweep / 5));
      for (let i = 1; i <= n; i++) { const a = d2r(a0 + dir * p.sweep * i / n); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      pose = { x: out[out.length - 1][0], y: out[out.length - 1][1], a: norm(pose.a + dir * p.sweep) };
    }
  }
  return out;
}
