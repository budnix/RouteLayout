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
  { id: '55200', code: 'G239', name: 'Prosta 239,07 mm', group: 'straight', geo: straight(G.G239), len: G.G239 },
  { id: '55201', code: 'G231', name: 'Prosta 230,93 mm', group: 'straight', geo: straight(G.G231), len: G.G231 },
  { id: '55202', code: 'G119', name: 'Prosta 119,54 mm', group: 'straight', geo: straight(G.G119), len: G.G119 },
  { id: '55203', code: 'G115', name: 'Prosta 115,46 mm', group: 'straight', geo: straight(G.G115), len: G.G115 },
  { id: '55204', code: 'G107', name: 'Prosta 107,32 mm (tor równoległy do K30)', group: 'straight', geo: straight(G.G107), len: G.G107 },
  { id: '55205', code: 'G62', name: 'Prosta 61,88 mm (łącznik między BW R3 i R4)', group: 'straight', geo: straight(G.G62), len: G.G62 },
  { id: '55206', code: 'G31', name: 'Prosta 30,94 mm', group: 'straight', geo: straight(G.G31), len: G.G31 },
  { id: '55207', code: 'ÜG', name: 'Przejściówka do starego toru Piko 62 mm', group: 'straight', geo: straight(G.G62), len: G.G62 },
  { id: '55208', code: 'ÜG', name: 'Przejściówka (profil 2,5 mm) 62 mm', group: 'straight', geo: straight(G.G62), len: G.G62 },
  { id: '55209', code: 'G940', name: 'Flex 940 mm (prosto)', group: 'flex', geo: straight(940), len: 940, flex: true },

  // Łuki
  { id: '55211', code: 'R1', name: 'Łuk R1 360 mm / 30°', group: 'curve', geo: curve(R.R1, 30, +1), r: R.R1, deg: 30 },
  { id: '55212', code: 'R2', name: 'Łuk R2 421,88 mm / 30°', group: 'curve', geo: curve(R.R2, 30, +1), r: R.R2, deg: 30 },
  { id: '55213', code: 'R3', name: 'Łuk R3 483,75 mm / 30°', group: 'curve', geo: curve(R.R3, 30, +1), r: R.R3, deg: 30 },
  { id: '55214', code: 'R4', name: 'Łuk R4 545,63 mm / 30°', group: 'curve', geo: curve(R.R4, 30, +1), r: R.R4, deg: 30 },
  { id: '55215', code: 'R1 7,5', name: 'Łuk R1 360 mm / 7,5°', group: 'curve', geo: curve(R.R1, 7.5, +1), r: R.R1, deg: 7.5, verified: false },
  { id: '55218', code: 'R2 7,5', name: 'Łuk R2 421,88 mm / 7,5°', group: 'curve', geo: curve(R.R2, 7.5, +1), r: R.R2, deg: 7.5 },
  { id: '55219', code: 'R9', name: 'Łuk R9 907,97 mm / 15° (przeciwłuk rozjazdu)', group: 'curve', geo: curve(R.R9, 15, +1), r: R.R9, deg: 15 },

  // Rozjazdy
  { id: '55220', code: 'WL', name: 'Rozjazd lewy 15°, R9, 239 mm', group: 'turnout', geo: turnout(G.G239, R.R9, 15, +1) },
  { id: '55221', code: 'WR', name: 'Rozjazd prawy 15°, R9, 239 mm', group: 'turnout', geo: turnout(G.G239, R.R9, 15, -1) },
  { id: '55222', code: 'BWL', name: 'Rozjazd łukowy lewy R2/R3, 30°', group: 'turnout', geo: curvedTurnout(R.R3, R.R2, 30, +1) },
  { id: '55223', code: 'BWR', name: 'Rozjazd łukowy prawy R2/R3, 30°', group: 'turnout', geo: curvedTurnout(R.R3, R.R2, 30, -1) },
  { id: '55227', code: 'BWL-R3', name: 'Rozjazd łukowy lewy R3/R4, 30°', group: 'turnout', geo: curvedTurnout(R.R4, R.R3, 30, +1) },
  { id: '55228', code: 'BWR-R3', name: 'Rozjazd łukowy prawy R3/R4, 30°', group: 'turnout', geo: curvedTurnout(R.R4, R.R3, 30, -1) },
  { id: '55225', code: 'W3', name: 'Rozjazd trójdrogowy 2×15°, R9, 239 mm', group: 'turnout', geo: threeWay(G.G239, R.R9, 15) },
  { id: '55226', code: 'WY', name: 'Rozjazd Y 2×15°, R9', group: 'turnout', geo: wye(R.R9, 15) },
  { id: '55224', code: 'DKW', name: 'Rozjazd krzyżowy podwójny 15°, 239 mm', group: 'crossing', geo: doubleSlip(G.G239, 15, R.R9) },

  // Krzyżownice
  { id: '55240', code: 'K15', name: 'Krzyżownica 15°, 239 mm', group: 'crossing', geo: crossing(G.G239, 15) },
  { id: '55241', code: 'K30', name: 'Krzyżownica 30°, 119,54 mm', group: 'crossing', geo: crossing(G.G119, 30) },

  // Akcesoria z geometrią
  { id: '55280', code: 'PB', name: 'Kozioł oporowy (nasadzany na prostą)', group: 'accessory', geo: straight(G.G62), len: G.G62, bumper: true },
];

// Odbicia lustrzane łuków (skręt w prawo) nie są osobnymi artykułami: fizyczny
// łuk obraca się. W edytorze łuk "w prawo" uzyskujemy przez wejście portem 1.

export const CATALOG = items;
export const BY_ID = Object.fromEntries(items.map((p) => [p.id, p]));

export const GROUPS = [
  { key: 'straight', label: 'Proste' },
  { key: 'curve', label: 'Łuki' },
  { key: 'turnout', label: 'Rozjazdy' },
  { key: 'crossing', label: 'Krzyżownice / DKW' },
  { key: 'flex', label: 'Flex' },
  { key: 'accessory', label: 'Akcesoria' },
];

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
