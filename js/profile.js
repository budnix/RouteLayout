// Profil systemu torów: wszystko, co algorytmy (normalizator, fitter, solver domykania, szablony)
// muszą wiedzieć o palecie, wyliczone z katalogu – bez numerów wpisanych na sztywno.
// Systemy o tej samej geometrii (PIKO z podsypką) dzielą profil bazowy (SYSTEMS[s].profile).
//
// Moduły algorytmiczne czytają `current.p`; punkty wejścia (fitStrokes, normalizeStroke, closeGap)
// wołają useSystem(system) na początku, więc profil nigdy nie „przecieka” między wywołaniami.

import { CATALOG, SYSTEMS, DEFAULT_SYSTEM } from './catalog.js';

const cache = new Map();

export function baseSystem(system) { return SYSTEMS[system]?.profile || (SYSTEMS[system] ? system : DEFAULT_SYSTEM); }

export function profileFor(system = DEFAULT_SYSTEM) {
  const base = baseSystem(system);
  if (cache.has(base)) return cache.get(base);
  const items = CATALOG.filter((p) => p.system === base);
  const arcOf = (p) => p.geo.segments.find((s) => s.type === 'arc');
  const angleOf = (seg) => Math.abs(seg.a1 - seg.a0);
  const dirOf = (seg) => Math.sign(seg.a1 - seg.a0);

  // proste do dekompozycji: bez flexa i elementów specjalnych (przejściówki), od najdłuższej
  const straights = items.filter((p) => p.group === 'straight' && !p.flex && !p.special && p.len).map((p) => [p.id, p.len]).sort((a, b) => b[1] - a[1]);
  // łuki pogrupowane promieniem: { r, pieces: [[id, kąt]] } rosnąco po r, kąty malejąco
  const byR = new Map();
  for (const p of items.filter((p) => p.group === 'curve')) { const r = +p.r.toFixed(2); if (!byR.has(r)) byR.set(r, []); byR.get(r).push([p.id, p.deg]); }
  const radii = [...byR.entries()].sort((a, b) => a[0] - b[0]).map(([r, pieces]) => ({ r, pieces: pieces.sort((a, b) => b[1] - a[1]) }));
  // rozjazdy zwykłe (prosta + jeden łuk, 3 porty) i łukowe (dwa łuki)
  const turnoutDefs = items.filter((p) => p.group === 'turnout' && p.geo.ports.length === 3);
  const standard = turnoutDefs.filter((p) => p.geo.segments[0].type === 'line');
  const curvedDefs = turnoutDefs.filter((p) => p.geo.segments.every((s) => s.type === 'arc'));
  const curvedTurnouts = [];
  for (const p of curvedDefs) {
    const [o, i] = p.geo.segments, key = `${o.r}/${i.r}`;
    let e = curvedTurnouts.find((c) => c.key === key);
    if (!e) { e = { key, left: null, right: null, rOut: Math.max(o.r, i.r), rIn: Math.min(o.r, i.r), deg: angleOf(o) }; curvedTurnouts.push(e); }
    if (dirOf(o) > 0) e.left = p.id; else e.right = p.id;
  }
  // krzyżownice po kącie; DKW (4 trasy) ma pierwszeństwo przed zwykłą krzyżownicą tego samego kąta
  const crossings = {};
  for (const p of items.filter((p) => p.group === 'crossing' && p.geo.segments[0].type === 'line' && p.geo.ports.length === 4)) {
    const deg = +Math.abs(p.geo.ports[3].a).toFixed(2), routes = (p.geo.routes || []).length;
    if (!crossings[deg] || routes > crossings[deg].routes) crossings[deg] = { id: p.id, routes };
  }
  const crossingIds = Object.fromEntries(Object.entries(crossings).map(([d, v]) => [d, v.id]));
  // jednostka kąta (snap kierunku startu): najmniejszy kąt ≥ 10° wśród łuków i rozjazdów
  const angles = [...radii.flatMap((r) => r.pieces.map((p) => p[1])), ...standard.map((p) => angleOf(arcOf(p))), ...curvedTurnouts.map((c) => c.deg)];
  const headingUnit = Math.min(...angles.filter((a) => a >= 10)) || 15;
  const turnoutLen = standard.length ? standard[0].geo.ports[1].x : straights[0][1];
  const unitStraight = (straights.find(([, len]) => Math.abs(len - turnoutLen) < 0.5) || straights[0])[1];
  // kary za „drobnicę”: krótkie proste, małe kąty, niezweryfikowane numery
  const smallest = radii[0]?.r || Infinity;
  const closePenalty = {}, fitPenalty = {};
  for (const [id, len] of straights) { if (len < 40) { closePenalty[id] = 4; fitPenalty[id] = 14; } else if (len < 70) { closePenalty[id] = 3; fitPenalty[id] = 14; } else if (len < 118) { closePenalty[id] = 1; } if (len >= 118 && len < 125) fitPenalty[id] = 5; }
  for (const { r, pieces } of radii) for (const [id, deg] of pieces) {
    const def = CATALOG.find((p) => p.id === id);
    if (deg < 10) { closePenalty[id] = def.verified === false ? 3 : 2; fitPenalty[id] = def.verified === false ? 12 : 10; }
    else if (r === smallest && !fitPenalty[id]) fitPenalty[id] = 3;
  }
  for (const p of standard) fitPenalty[p.id] = 6;

  const profile = {
    system: base, straights, radii, minRealR: smallest * 0.8, headingUnit, turnoutLen, unitStraight,
    turnouts: standard.map((p) => p.id),
    curvedTurnouts: curvedTurnouts.filter((c) => c.left && c.right).map((c) => [c.left, c.right, c.rOut, c.rIn, c.deg]),
    crossings: crossingIds,
    closePenalty, fitPenalty,
    parallel: SYSTEMS[base]?.parallel || null,
  };
  cache.set(base, profile);
  return profile;
}

export const current = { p: null };
/** Ustawia profil dla kolejnych wywołań algorytmów; zwraca go. */
export function useSystem(system = DEFAULT_SYSTEM) { current.p = profileFor(system); return current.p; }
useSystem(DEFAULT_SYSTEM);
