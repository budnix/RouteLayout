// Katalog torów PIKO A-Gleis H0 (seria 552xx, bez podsypki) z geometrią.
//
// Jednostki: milimetry, stopnie. Układ lokalny elementu: port 0 leży w (0,0)
// i "wchodzi" w element wzdłuż osi +X. Każdy port ma pozycję i kierunek
// WYJŚCIOWY (kąt w stopniach, 0 = +X, rośnie przeciwnie do wskazówek zegara
// w układzie matematycznym; canvas odwraca Y przy rysowaniu).
//
// Segmenty:
//   { type:'line', x1,y1,x2,y2 }
//   { type:'arc', cx,cy, r, a0,a1 }   // a0 -> a1 w stopniach, znak sweep = kierunek
//
// Źródła geometrii: prospekt PIKO A-Gleis (moduł 470 mm, rozstaw równoległy
// 61,88 mm) oraz opisy handlowe. Elementy z verified:false mają numer katalogowy
// wymagający potwierdzenia — geometria jest poprawna, numer może się różnić.

export const GAUGE = 16.5;          // rozstaw szyn H0
export const PARALLEL = 61.88;      // rozstaw torów równoległych w systemie Piko A
export const R = { R1: 360.0, R2: 421.88, R3: 483.75, R4: 545.63, R9: 907.97 };
export const G = { G239: 239.07, G231: 230.93, G119: 119.54, G115: 115.46, G107: 107.32, G62: 61.88, G31: 30.94 };

const d2r = (d) => (d * Math.PI) / 180;

// ---- prymitywy geometrii -------------------------------------------------

/** Prosta o długości L od (0,0) w +X. */
function straight(L) {
  return {
    segments: [{ type: 'line', x1: 0, y1: 0, x2: L, y2: 0 }],
    ports: [{ x: 0, y: 0, a: 180 }, { x: L, y: 0, a: 0 }],
  };
}

/**
 * Łuk o promieniu r i kącie deg, startujący w (0,0) z kierunkiem +X.
 * dir = +1 skręt w lewo (środek w (0, r)), -1 w prawo (środek w (0,-r)).
 * Zwraca segment i port końcowy.
 */
function arcFrom(r, deg, dir, x0 = 0, y0 = 0, heading = 0) {
  const h = d2r(heading);
  // środek: prostopadle do kierunku, po stronie skrętu
  const cx = x0 - dir * r * Math.sin(h);
  const cy = y0 + dir * r * Math.cos(h);
  const a0 = heading - dir * 90;       // kąt promienia na starcie
  const a1 = a0 + dir * deg;           // kąt promienia na końcu
  const ex = cx + r * Math.cos(d2r(a1));
  const ey = cy + r * Math.sin(d2r(a1));
  return {
    segment: { type: 'arc', cx, cy, r, a0, a1 },
    end: { x: ex, y: ey, a: heading + dir * deg },
  };
}

function curve(r, deg, dir) {
  const a = arcFrom(r, deg, dir);
  return { segments: [a.segment], ports: [{ x: 0, y: 0, a: 180 }, a.end] };
}

/** Rozjazd zwykły: prosta L + odgałęzienie łukiem (r, deg) w stronę dir. */
function turnout(L, r, deg, dir) {
  const a = arcFrom(r, deg, dir);
  return {
    segments: [{ type: 'line', x1: 0, y1: 0, x2: L, y2: 0 }, a.segment],
    ports: [{ x: 0, y: 0, a: 180 }, { x: L, y: 0, a: 0 }, a.end],
    // pary portów połączone przejezdnie: (0,1) prosto, (0,2) odgałęzienie
    routes: [[0, 1], [0, 2]],
  };
}

/** Rozjazd łukowy: dwa łuki (zewnętrzny rOut, wewnętrzny rIn) o wspólnym początku. */
function curvedTurnout(rOut, rIn, deg, dir) {
  const o = arcFrom(rOut, deg, dir);
  const i = arcFrom(rIn, deg, dir);
  return {
    segments: [o.segment, i.segment],
    ports: [{ x: 0, y: 0, a: 180 }, o.end, i.end],
    routes: [[0, 1], [0, 2]],
  };
}

/** Rozjazd trójdrogowy: prosta + łuk w lewo + łuk w prawo. */
function threeWay(L, r, deg) {
  const l = arcFrom(r, deg, +1);
  const rr = arcFrom(r, deg, -1);
  return {
    segments: [{ type: 'line', x1: 0, y1: 0, x2: L, y2: 0 }, l.segment, rr.segment],
    ports: [{ x: 0, y: 0, a: 180 }, { x: L, y: 0, a: 0 }, l.end, rr.end],
    routes: [[0, 1], [0, 2], [0, 3]],
  };
}

/** Rozjazd Y: łuk w lewo + łuk w prawo. */
function wye(r, deg) {
  const l = arcFrom(r, deg, +1);
  const rr = arcFrom(r, deg, -1);
  return {
    segments: [l.segment, rr.segment],
    ports: [{ x: 0, y: 0, a: 180 }, l.end, rr.end],
    routes: [[0, 1], [0, 2]],
  };
}

/** Krzyżownica: dwie proste o długości L przecinające się w środku pod kątem deg. */
function crossing(L, deg) {
  const c = L / 2;
  const dx = c * Math.cos(d2r(deg));
  const dy = c * Math.sin(d2r(deg));
  return {
    segments: [
      { type: 'line', x1: 0, y1: 0, x2: L, y2: 0 },
      { type: 'line', x1: c - dx, y1: -dy, x2: c + dx, y2: dy },
    ],
    ports: [
      { x: 0, y: 0, a: 180 },
      { x: L, y: 0, a: 0 },
      { x: c - dx, y: -dy, a: 180 + deg },
      { x: c + dx, y: dy, a: deg },
    ],
    routes: [[0, 1], [2, 3]],
  };
}

/** Rozjazd krzyżowy podwójny (DKW): krzyżownica 15° + dwa łuki R9 łączące ramiona. */
function doubleSlip(L, deg, r) {
  const k = crossing(L, deg);
  const a = arcFrom(r, deg, +1);                  // z portu 0 w lewo -> port 3
  const b = arcFrom(r, deg, +1, L, 0, 180);       // z portu 1 (kierunek 180°) -> port 2
  return {
    segments: [...k.segments, a.segment, b.segment],
    ports: k.ports,
    routes: [[0, 1], [2, 3], [0, 3], [1, 2]],
  };
}

// ---- katalog ---------------------------------------------------------------

const items = [
  // Proste
  { id: '55200', code: 'G239', name: { pl: 'Prosta 239,07 mm', en: 'Straight 239.07 mm', de: 'Gerades Gleis 239,07 mm' }, group: 'straight', geo: straight(G.G239), len: G.G239 },
  { id: '55201', code: 'G231', name: { pl: 'Prosta 230,93 mm', en: 'Straight 230.93 mm', de: 'Gerades Gleis 230,93 mm' }, group: 'straight', geo: straight(G.G231), len: G.G231 },
  { id: '55202', code: 'G119', name: { pl: 'Prosta 119,54 mm', en: 'Straight 119.54 mm', de: 'Gerades Gleis 119,54 mm' }, group: 'straight', geo: straight(G.G119), len: G.G119 },
  { id: '55203', code: 'G115', name: { pl: 'Prosta 115,46 mm', en: 'Straight 115.46 mm', de: 'Gerades Gleis 115,46 mm' }, group: 'straight', geo: straight(G.G115), len: G.G115 },
  { id: '55204', code: 'G107', name: { pl: 'Prosta 107,32 mm (tor równoległy do K30)', en: 'Straight 107.32 mm (parallel track for K30)', de: 'Gerades Gleis 107,32 mm (Parallelgleis zur K30)' }, group: 'straight', geo: straight(G.G107), len: G.G107 },
  { id: '55205', code: 'G62', name: { pl: 'Prosta 61,88 mm (łącznik między BW R3 i R4)', en: 'Straight 61.88 mm (filler between curved turnouts R3/R4)', de: 'Gerades Gleis 61,88 mm (Verbindungsstück zwischen Bogenweichen R3/R4)' }, group: 'straight', geo: straight(G.G62), len: G.G62 },
  { id: '55206', code: 'G31', name: { pl: 'Prosta 30,94 mm', en: 'Straight 30.94 mm', de: 'Gerades Gleis 30,94 mm' }, group: 'straight', geo: straight(G.G31), len: G.G31 },
  { id: '55207', code: 'ÜG', name: { pl: 'Przejściówka do starego toru Piko 62 mm', en: 'Transition track to old PIKO track, 62 mm', de: 'Übergangsgleis zum alten PIKO-Gleis, 62 mm' }, group: 'straight', geo: straight(G.G62), len: G.G62 },
  { id: '55208', code: 'ÜG', name: { pl: 'Przejściówka (profil 2,5 mm) 62 mm', en: 'Transition track (2.5 mm profile), 62 mm', de: 'Übergangsgleis (Profil 2,5 mm), 62 mm' }, group: 'straight', geo: straight(G.G62), len: G.G62 },
  { id: '55209', code: 'G940', name: { pl: 'Flex 940 mm (prosto)', en: 'Flex track 940 mm (straight)', de: 'Flexgleis 940 mm (gerade)' }, group: 'flex', geo: straight(940), len: 940, flex: true },

  // Łuki
  { id: '55211', code: 'R1', name: { pl: 'Łuk R1 360 mm / 30°', en: 'Curve R1 360 mm / 30°', de: 'Bogen R1 360 mm / 30°' }, group: 'curve', geo: curve(R.R1, 30, +1), r: R.R1, deg: 30 },
  { id: '55212', code: 'R2', name: { pl: 'Łuk R2 421,88 mm / 30°', en: 'Curve R2 421.88 mm / 30°', de: 'Bogen R2 421,88 mm / 30°' }, group: 'curve', geo: curve(R.R2, 30, +1), r: R.R2, deg: 30 },
  { id: '55213', code: 'R3', name: { pl: 'Łuk R3 483,75 mm / 30°', en: 'Curve R3 483.75 mm / 30°', de: 'Bogen R3 483,75 mm / 30°' }, group: 'curve', geo: curve(R.R3, 30, +1), r: R.R3, deg: 30 },
  { id: '55214', code: 'R4', name: { pl: 'Łuk R4 545,63 mm / 30°', en: 'Curve R4 545.63 mm / 30°', de: 'Bogen R4 545,63 mm / 30°' }, group: 'curve', geo: curve(R.R4, 30, +1), r: R.R4, deg: 30 },
  { id: '55215', code: 'R1 7,5', name: { pl: 'Łuk R1 360 mm / 7,5°', en: 'Curve R1 360 mm / 7.5°', de: 'Bogen R1 360 mm / 7,5°' }, group: 'curve', geo: curve(R.R1, 7.5, +1), r: R.R1, deg: 7.5, verified: false },
  { id: '55218', code: 'R2 7,5', name: { pl: 'Łuk R2 421,88 mm / 7,5°', en: 'Curve R2 421.88 mm / 7.5°', de: 'Bogen R2 421,88 mm / 7,5°' }, group: 'curve', geo: curve(R.R2, 7.5, +1), r: R.R2, deg: 7.5 },
  { id: '55219', code: 'R9', name: { pl: 'Łuk R9 907,97 mm / 15° (przeciwłuk rozjazdu)', en: 'Curve R9 907.97 mm / 15° (turnout counter-curve)', de: 'Weichengegenbogen R9 907,97 mm / 15°' }, group: 'curve', geo: curve(R.R9, 15, +1), r: R.R9, deg: 15 },

  // Rozjazdy
  { id: '55220', code: 'WL', name: { pl: 'Rozjazd lewy 15°, R9, 239 mm', en: 'Left turnout 15°, R9, 239 mm', de: 'Weiche links 15°, R9, 239 mm' }, group: 'turnout', geo: turnout(G.G239, R.R9, 15, +1) },
  { id: '55221', code: 'WR', name: { pl: 'Rozjazd prawy 15°, R9, 239 mm', en: 'Right turnout 15°, R9, 239 mm', de: 'Weiche rechts 15°, R9, 239 mm' }, group: 'turnout', geo: turnout(G.G239, R.R9, 15, -1) },
  { id: '55222', code: 'BWL', name: { pl: 'Rozjazd łukowy lewy R2/R3, 30°', en: 'Left curved turnout R2/R3, 30°', de: 'Bogenweiche links R2/R3, 30°' }, group: 'turnout', geo: curvedTurnout(R.R3, R.R2, 30, +1) },
  { id: '55223', code: 'BWR', name: { pl: 'Rozjazd łukowy prawy R2/R3, 30°', en: 'Right curved turnout R2/R3, 30°', de: 'Bogenweiche rechts R2/R3, 30°' }, group: 'turnout', geo: curvedTurnout(R.R3, R.R2, 30, -1) },
  { id: '55227', code: 'BWL-R3', name: { pl: 'Rozjazd łukowy lewy R3/R4, 30°', en: 'Left curved turnout R3/R4, 30°', de: 'Bogenweiche links R3/R4, 30°' }, group: 'turnout', geo: curvedTurnout(R.R4, R.R3, 30, +1) },
  { id: '55228', code: 'BWR-R3', name: { pl: 'Rozjazd łukowy prawy R3/R4, 30°', en: 'Right curved turnout R3/R4, 30°', de: 'Bogenweiche rechts R3/R4, 30°' }, group: 'turnout', geo: curvedTurnout(R.R4, R.R3, 30, -1) },
  { id: '55225', code: 'W3', name: { pl: 'Rozjazd trójdrogowy 2×15°, R9, 239 mm', en: 'Three-way turnout 2×15°, R9, 239 mm', de: 'Dreiwegweiche 2×15°, R9, 239 mm' }, group: 'turnout', geo: threeWay(G.G239, R.R9, 15) },
  { id: '55226', code: 'WY', name: { pl: 'Rozjazd Y 2×15°, R9', en: 'Y turnout 2×15°, R9', de: 'Y-Weiche 2×15°, R9' }, group: 'turnout', geo: wye(R.R9, 15) },
  { id: '55224', code: 'DKW', name: { pl: 'Rozjazd krzyżowy podwójny 15°, 239 mm', en: 'Double slip 15°, 239 mm', de: 'Doppelkreuzungsweiche 15°, 239 mm' }, group: 'crossing', geo: doubleSlip(G.G239, 15, R.R9) },

  // Krzyżownice
  { id: '55240', code: 'K15', name: { pl: 'Krzyżownica 15°, 239 mm', en: 'Crossing 15°, 239 mm', de: 'Kreuzung 15°, 239 mm' }, group: 'crossing', geo: crossing(G.G239, 15) },
  { id: '55241', code: 'K30', name: { pl: 'Krzyżownica 30°, 119,54 mm', en: 'Crossing 30°, 119.54 mm', de: 'Kreuzung 30°, 119,54 mm' }, group: 'crossing', geo: crossing(G.G119, 30) },

  // Akcesoria z geometrią
  { id: '55280', code: 'PB', name: { pl: 'Kozioł oporowy (nasadzany na prostą)', en: 'Buffer stop (clips onto a straight)', de: 'Prellbock (auf gerades Gleis aufsteckbar)' }, group: 'accessory', geo: straight(G.G62), len: G.G62, bumper: true },
];

// Odbicia lustrzane łuków (skręt w prawo) nie są osobnymi artykułami: fizyczny
// łuk obraca się. W edytorze łuk "w prawo" uzyskujemy przez wejście portem 1.

// Obrotnica – element o geometrii zależnej od instancji (średnica, kąt mostu,
// lista kątów, pod którymi doczepiono tory). Środek w lokalnym (0,0).
export const TURNTABLE_ID = 'TT';
items.push({ id: TURNTABLE_ID, code: 'TT', group: 'accessory', turntable: true, dynamic: true, r: 160,
  name: { pl: 'Obrotnica (⌀ regulowana, tory w dowolnym punkcie)', en: 'Turntable (adjustable ⌀, tracks at any angle)', de: 'Drehscheibe (⌀ einstellbar, Gleise in jedem Winkel)' },
  geo: turntableGeo({ r: 160, bridge: 0, angles: [] }) });

/**
 * Geometria obrotnicy: segment mostu przez środek oraz porty – dwa końce mostu
 * (0 i 1) i kolejne dla każdego kąta z `angles` (na obrzeżu, kierunek na zewnątrz).
 */
export function turntableGeo(piece) {
  const r = piece.r || 160, b = piece.bridge || 0;
  const bx = r * Math.cos(d2r(b)), by = r * Math.sin(d2r(b));
  const ports = [{ x: bx, y: by, a: b }, { x: -bx, y: -by, a: b + 180 }];
  for (const a of piece.angles || []) {
    if (Math.abs(((a - b) % 180 + 180) % 180) < 0.5) continue; // pokrywa się z końcem mostu
    ports.push({ x: r * Math.cos(d2r(a)), y: r * Math.sin(d2r(a)), a });
  }
  return { segments: [{ type: 'line', x1: -bx, y1: -by, x2: bx, y2: by }], ports, routes: [[0, 1]] };
}

/** Geometria elementu – z katalogu lub liczona z instancji (obrotnica). */
export function geoOf(piece) {
  const def = BY_ID[piece.id];
  return def.dynamic ? turntableGeo(piece) : def.geo;
}

// ---- systemy torów ----------------------------------------------------------------
// Ten sam katalog geometrii obsługuje kilka systemów. PIKO A-Gleis z podsypką
// (seria 554xx) ma identyczną geometrię, a numer = 552xx + 200 (potwierdzone dla
// 55418 = R2 7,5°; pozostałe numery oznaczone do weryfikacji przed zamówieniem).
export const SYSTEMS = {
  'piko-a': { name: { pl: 'PIKO A-Gleis (bez podsypki, 552xx)', en: 'PIKO A-Gleis (no roadbed, 552xx)', de: 'PIKO A-Gleis (ohne Bettung, 552xx)' } },
  'piko-a-bed': { name: { pl: 'PIKO A-Gleis z podsypką (554xx)', en: 'PIKO A-Gleis with roadbed (554xx)', de: 'PIKO A-Gleis mit Bettung (554xx)' }, suffix: { pl: ' (z podsypką)', en: ' (roadbed)', de: ' (Bettung)' } },
};
export const DEFAULT_SYSTEM = 'piko-a';
for (const it of items) if (!it.system) it.system = it.id.startsWith('552') ? 'piko-a' : 'common';
const bedded = items.filter((it) => it.system === 'piko-a' && it.group !== 'accessory').map((base) => ({
  ...base,
  id: '554' + base.id.slice(3),
  system: 'piko-a-bed',
  base: base.id,
  name: Object.fromEntries(Object.entries(base.name).map(([k, v]) => [k, v + SYSTEMS['piko-a-bed'].suffix[k]])),
  verified: base.id === '55218' ? base.verified !== false : false,
}));
items.push(...bedded);

/** Odpowiednik elementu w danym systemie (obrotnica, kozioł itp. bez zmian). */
export function toSystem(id, system = DEFAULT_SYSTEM) {
  const def = BY_ID[id];
  if (!def || def.system === 'common' || def.system === system) return id;
  const baseId = def.base || def.id;
  if (system === 'piko-a') return baseId;
  const target = items.find((it) => it.system === system && it.base === baseId);
  return target ? target.id : id;
}

export const CATALOG = items;
export const BY_ID = Object.fromEntries(items.map((p) => [p.id, p]));

// Etykiety grup: klucze i18n 'group.<key>'.
export const GROUPS = ['straight', 'curve', 'turnout', 'crossing', 'flex', 'accessory'];

/** Najczęściej używane — szybkie przyciski w palecie. */
export const QUICK = ['55200', '55201', '55202', '55212', '55213', '55220', '55221', '55219'];

// ---- pomocnicze: próbkowanie segmentów -------------------------------------

/** Zwraca listę punktów [x,y] wzdłuż segmentu (lokalnie), co ~step mm. */
export function sampleSegment(seg, step = 10) {
  if (seg.type === 'line') {
    const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
    const L = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(L / step));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([seg.x1 + (dx * i) / n, seg.y1 + (dy * i) / n]);
    return pts;
  }
  const sweep = seg.a1 - seg.a0;
  const L = Math.abs(d2r(sweep)) * seg.r;
  const n = Math.max(2, Math.ceil(L / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = d2r(seg.a0 + (sweep * i) / n);
    pts.push([seg.cx + seg.r * Math.cos(a), seg.cy + seg.r * Math.sin(a)]);
  }
  return pts;
}

/** Długość segmentu w mm. */
export function segmentLength(seg) {
  if (seg.type === 'line') return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  return Math.abs(d2r(seg.a1 - seg.a0)) * seg.r;
}
