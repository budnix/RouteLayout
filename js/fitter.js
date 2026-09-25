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

import { BY_ID, sampleSegment } from './catalog.js';
import { Layout, norm } from './layout.js';

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
  return pts.map((_, i) => {
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
export function fitStrokes(rawStrokes, layout) {
  const strokes = rawStrokes.map((r) => prepareStroke(r)).filter(Boolean).map((s) => ({ ...s, done: false, start: null }));
  strokes.sort((a, b) => b.len - a.len);
  const pieces = [];
  let openPorts = layout ? layout.openPorts().map((p) => ({ x: p.x, y: p.y, a: p.a })) : [];

  const addPiece = (piece) => {
    pieces.push(piece);
    const n = BY_ID[piece.id].geo.ports.length;
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
    if (d < BRANCH_DIST && Math.abs(norm(s.tan[i] - port.a)) < BRANCH_ANG && (!best || d < best.d)) best = { d, stroke: s, reverse: false, pose: { x: port.x, y: port.y, a: port.a } };
    const j = n - 1 - i;
    const dj = Math.hypot(s.pts[j][0] - port.x, s.pts[j][1] - port.y);
    if (dj < BRANCH_DIST && Math.abs(norm(s.tan[j] + 180 - port.a)) < BRANCH_ANG && (!best || dj < best.d)) best = { d: dj, stroke: s, reverse: true, pose: { x: port.x, y: port.y, a: port.a } };
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
