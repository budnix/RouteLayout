// Domykanie szczeliny między dwoma otwartymi końcami toru elementami z palety.
//
// Szukamy ciągu 1..3 elementów doklejonych do portu A tak, by ostatni port
// wyjściowy pokrył się z portem B (pozycja i kierunek przeciwny). Kandydaci:
// proste + łuki w obie strony. 21 kandydatów × 3 miejsca = ~9,7 tys. ciągów –
// milisekundy. Wynik: najlepszy ciąg z błędem, albo diagnoza, ile brakuje.

import { BY_ID, geoOf } from './catalog.js';
import { Layout, norm } from './layout.js';

const STRAIGHTS = ['55200', '55201', '55202', '55203', '55204', '55205', '55206'];
const CURVES = ['55211', '55212', '55213', '55214', '55218', '55215', '55219'];
const CANDIDATES = [...STRAIGHTS.map((id) => [id, 0]), ...CURVES.flatMap((id) => [[id, 0], [id, 1]])];
const PENALTY = { '55206': 4, '55205': 3, '55215': 3, '55218': 2, '55203': 1, '55204': 1 };

export const CLOSE_POS_TOL = 1.5;   // mm
export const CLOSE_ANG_TOL = 1.5;   // °
const d2r = (d) => (d * Math.PI) / 180;

/** Pozycja i kierunek portu wyjściowego po doklejeniu (id, entry) do pozy. */
function step(pose, id, entry) {
  const p = Layout.poseFor(id, entry, { x: pose.x, y: pose.y, a: pose.a });
  const piece = { id, x: p.x, y: p.y, rot: p.rot };
  const exit = Layout.worldPort(piece, entry === 0 ? 1 : 0);
  return { piece, pose: { x: exit.x, y: exit.y, a: exit.a } };
}

/** Błąd między pozą wyjściową a portem docelowym: odległość [mm] i różnica kąta [°] (kierunki przeciwne). */
function gapError(pose, target) {
  return { d: Math.hypot(pose.x - target.x, pose.y - target.y), da: Math.abs(norm(pose.a - target.a + 180)) };
}

/**
 * @param {{x,y,a,z?}} from port A (kierunek "na zewnątrz")
 * @param {{x,y,a,z?}} to   port B (kierunek "na zewnątrz")
 * @param {number} maxPieces 1..3
 * @returns {{ ok:boolean, pieces:object[], error:{d,da}, gap:{d,da} }}
 */
export function closeGap(from, to, maxPieces = 4) {
  if (!from || !to) return { ok: false, pieces: [], error: null, gap: null };
  const gap = gapError(from, to);
  let best = null;
  const consider = (pieces, pose) => {
    const e = gapError(pose, to);
    // dokładne rozwiązania zawsze przed niedokładnymi; wśród dokładnych – mniej elementów i mniej "drobnicy";
    // wśród niedokładnych – najmniejszy błąd (do diagnozy "ile brakuje")
    const exact = e.d <= CLOSE_POS_TOL && e.da <= CLOSE_ANG_TOL;
    const cost = (exact ? 0 : 1e6 + e.d + 4 * e.da) + 6 * pieces.length + pieces.reduce((s, p) => s + (PENALTY[p.id] || 0), 0);
    if (!best || cost < best.cost) best = { cost, pieces, error: e };
  };
  const rec = (pose, pieces, depth) => {
    for (const [id, entry] of CANDIDATES) {
      const s = step(pose, id, entry);
      const next = [...pieces, s.piece];
      consider(next, s.pose);
      // przycinanie: jeśli po tym kroku jesteśmy dalej niż 3 długości elementu od celu, nie schodź głębiej
      if (depth + 1 < maxPieces && Math.hypot(s.pose.x - to.x, s.pose.y - to.y) < 900) rec(s.pose, next, depth + 1);
    }
  };
  rec({ x: from.x, y: from.y, a: from.a }, [], 0);
  const ok = !!best && best.error.d <= CLOSE_POS_TOL && best.error.da <= CLOSE_ANG_TOL;
  const z = from.z || 0;
  const pieces = ok ? best.pieces.map((p) => ({ ...p, z, dz: 0 })) : [];
  return { ok, pieces, error: best ? best.error : gap, gap };
}

/**
 * Wybiera partnera dla portu A: najbliższy inny otwarty port zwrócony mniej więcej
 * naprzeciw (różnica kierunków w granicach 70°), w promieniu maxDist.
 */
export function pickPartner(layout, portA, maxDist = 900) {
  let best = null;
  for (const p of layout.openPorts()) {
    if (p.piece === portA.piece && p.idx === portA.idx) continue;
    if (BY_ID[p.piece.id].turntable && p.idx > 1) continue;    // porty obrzeża obrotnicy pomijamy
    const d = Math.hypot(p.x - portA.x, p.y - portA.y);
    if (d > maxDist) continue;
    // B powinien być "przed" A w kierunku jazdy i skierowany w stronę A
    const ahead = (p.x - portA.x) * Math.cos(d2r(portA.a)) + (p.y - portA.y) * Math.sin(d2r(portA.a));
    if (ahead < -50) continue;
    if (Math.abs(norm(p.a - portA.a + 180)) > 70) continue;
    if (!best || d < best.d) best = { d, port: p };
  }
  return best ? best.port : null;
}

/** Czy element ma port o indeksie idx (pomocnicze dla testów). */
export function hasPort(piece, idx) { return idx < geoOf(piece).ports.length; }
