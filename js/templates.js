// Szablony: gotowe zestawy elementów o dokładnej geometrii katalogowej, wstawiane jednym krokiem.
// Krok: { id, entry, from: [indeksKroku, port] } – `from` domyślnie = port wyjściowy poprzedniego kroku.
//
// Mijanka na rozjazdach 15°/R9: wybieg jednego łuku R9 przy 15° to 235,0 mm, a G239 + G231 = 470,0 mm
// = dwa takie łuki, więc między ostrzami musi leżeć G231 + G239 + G231; łuk powrotny domyka się co do 0,0 mm.
// Przejście na tor równoległy (61,88 mm): odnoga rozjazdu + drugi rozjazd wejściem odnogą.

import { BY_ID, geoOf } from './catalog.js';
import { baseSystem } from './profile.js';
import { Layout } from './layout.js';

// `bend` = port wejściowy łuków R9: 1 dla mijanki w lewo, 0 dla lustrzanej w prawo (łuk portem 1 skręca w drugą stronę)
const siding = (first, last, bend) => [
  { id: first, entry: 0 },                       // 0: rozjazd wjazdowy (tor główny)
  { id: '55201', entry: 0 },                     // 1: G231
  { id: '55200', entry: 0 },                     // 2: G239
  { id: '55201', entry: 0 },                     // 3: G231
  { id: last, entry: 1 },                        // 4: rozjazd wyjazdowy, wejście torem prostym
  { id: '55219', entry: bend, from: [0, 2] },    // 5: przeciwłuk R9 z odnogi
  { id: '55200', entry: 0 },                     // 6: G239 toru mijankowego
  { id: '55219', entry: bend },                  // 7: łuk powrotny (znów przeciwłuk – tor mijankowy skręca ku głównemu) → odnoga rozjazdu wyjazdowego
];
const crossover = (first, second) => [
  { id: first, entry: 0 },
  { id: second, entry: 2, from: [0, 2] },        // drugi rozjazd wjeżdża odnogą: tory równoległe co 61,88 mm
];

// Szablony per system bazowy (numery mapuje paleta przez toCurrentSystem). Setrack: mijanka nie domyka się
// dokładnie w katalogu (4×167,6 ≠ 672), więc tylko przejścia na tor równoległy (67 mm).
export const TEMPLATES_BY_SYSTEM = {
  'piko-a': {
    sidingLeft: { steps: siding('55220', '55221', 1), exit: [4, 0] },
    sidingRight: { steps: siding('55221', '55220', 0), exit: [4, 0] },
    crossoverLeft: { steps: crossover('55220', '55221'), exit: [0, 1] },
    crossoverRight: { steps: crossover('55221', '55220'), exit: [0, 1] },
  },
  'peco-setrack': {
    crossoverLeft: { steps: crossover('ST-241', 'ST-240'), exit: [0, 1] },
    crossoverRight: { steps: crossover('ST-240', 'ST-241'), exit: [0, 1] },
  },
};
export const TEMPLATES = TEMPLATES_BY_SYSTEM['piko-a'];
/** Szablony dostępne w danym systemie torów (po systemie bazowym). */
export function templatesFor(system) { return TEMPLATES_BY_SYSTEM[baseSystem(system)] || {}; }
const findTemplate = (key) => { for (const set of Object.values(TEMPLATES_BY_SYSTEM)) if (set[key]) return set[key]; return null; };

/** Buduje elementy szablonu (bez uid) od pozy startowej { x, y, a, z }; zwraca { pieces, exit } (port końca toru głównego). */
export function buildTemplate(key, start, system = null) {
  const tpl = (system ? templatesFor(system)[key] : null) || findTemplate(key);
  const pieces = [];
  let prevExit = { x: start.x, y: start.y, a: start.a, z: start.z || 0 };
  for (const step of tpl.steps) {
    const target = step.from ? Layout.worldPort(pieces[step.from[0]], step.from[1]) : prevExit;
    const p = Layout.poseFor(step.id, step.entry, target);
    const piece = { id: step.id, x: p.x, y: p.y, rot: p.rot, z: target.z || 0 };
    pieces.push(piece);
    const exitIdx = BY_ID[step.id].group === 'turnout' && step.entry === 2 ? 0 : (step.entry ^ 1);
    prevExit = Layout.worldPort(piece, exitIdx);
  }
  return { pieces, exit: Layout.worldPort(pieces[tpl.exit[0]], tpl.exit[1]) };
}

/** Lista kodów elementów szablonu (do opisu w palecie i BOM). */
export function templateCodes(key, system = null) {
  const counts = new Map();
  for (const s of ((system ? templatesFor(system)[key] : null) || findTemplate(key)).steps) counts.set(s.id, (counts.get(s.id) || 0) + 1);
  return [...counts.entries()].map(([id, n]) => `${n}× ${BY_ID[id].code}`).join(', ');
}

/** Segmenty świata szablonu zbudowanego od (0,0) – do miniatury. */
export function templateOutline(key, system = null) {
  const { pieces } = buildTemplate(key, { x: 0, y: 0, a: 0 }, system);
  return pieces.flatMap((p) => geoOf(p).segments.map((seg) => ({ piece: p, seg })));
}
