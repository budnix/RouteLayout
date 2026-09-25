// Sceneria: statyczne obiekty (drzewa, budynki, drogi, obrotnica…) do
// wizualizacji makiety. Każdy typ ma: domyślny rozmiar w mm, warstwę
// (teren pod torami / obiekty nad torami), rysowanie 2D na Canvas i
// budowę bryły 3D z prymitywów three.js – bez zewnętrznych modeli.
//
// Obiekt w układzie: { uid, type, x, y, rot, w, h } – (x,y) to środek,
// w = wymiar wzdłuż osi lokalnej X, h = wzdłuż Y (mm), rot w stopniach.

import * as THREE from '../vendor/three.module.js';

const d2r = (d) => (d * Math.PI) / 180;

const C = {
  trunk: 0x6b4a2b, conifer: 0x2f6b3a, leaf: 0x4f9a3c, bush: 0x5fa64a,
  wall: 0xe8dcc2, wall2: 0xd9c4a3, roof: 0x9b3b2e, roof2: 0x5a5f6a, brick: 0xb0533b,
  road: 0x555a60, roadLine: 0xe8e2c8, platform: 0xbdb7a8, platformEdge: 0xf0e6c8,
  water: 0x4f8fc9, hill: 0x6f9c4e, pit: 0x7a7570, bridge: 0x3a3f45, steel: 0x8a8f95,
  stone: 0x8c8780, window: 0x9fc4e0,
};

export const SCENERY_GROUPS = ['trees', 'buildings', 'infra', 'terrain'];

export const SCENERY = {
  conifer:   { group: 'trees', w: 40, h: 40, layer: 'top', resize: 'uniform', name: { pl: 'Drzewo iglaste', en: 'Conifer', de: 'Nadelbaum' } },
  deciduous: { group: 'trees', w: 50, h: 50, layer: 'top', resize: 'uniform', name: { pl: 'Drzewo liściaste', en: 'Deciduous tree', de: 'Laubbaum' } },
  bush:      { group: 'trees', w: 25, h: 25, layer: 'top', resize: 'uniform', name: { pl: 'Krzew', en: 'Bush', de: 'Busch' } },
  house:     { group: 'buildings', w: 120, h: 90, layer: 'top', resize: 'free', name: { pl: 'Dom', en: 'House', de: 'Wohnhaus' } },
  station:   { group: 'buildings', w: 260, h: 90, layer: 'top', resize: 'free', name: { pl: 'Dworzec', en: 'Station', de: 'Bahnhof' } },
  warehouse: { group: 'buildings', w: 220, h: 120, layer: 'top', resize: 'free', name: { pl: 'Magazyn / hala', en: 'Warehouse', de: 'Lagerhalle' } },
  church:    { group: 'buildings', w: 110, h: 200, layer: 'top', resize: 'free', name: { pl: 'Kościół', en: 'Church', de: 'Kirche' } },
  road:      { group: 'infra', w: 600, h: 70, layer: 'ground', resize: 'free', name: { pl: 'Droga', en: 'Road', de: 'Straße' } },
  platform:  { group: 'infra', w: 500, h: 40, layer: 'ground', resize: 'free', name: { pl: 'Peron', en: 'Platform', de: 'Bahnsteig' } },
  turntable: { group: 'infra', w: 320, h: 320, layer: 'ground', resize: 'uniform', name: { pl: 'Obrotnica', en: 'Turntable', de: 'Drehscheibe' } },
  portal:    { group: 'infra', w: 70, h: 30, layer: 'top', resize: 'uniform', name: { pl: 'Portal tunelu', en: 'Tunnel portal', de: 'Tunnelportal' } },
  watertower:{ group: 'infra', w: 50, h: 50, layer: 'top', resize: 'uniform', name: { pl: 'Wieża ciśnień', en: 'Water tower', de: 'Wasserturm' } },
  pond:      { group: 'terrain', w: 300, h: 200, layer: 'ground', resize: 'free', name: { pl: 'Staw', en: 'Pond', de: 'Teich' } },
  hill:      { group: 'terrain', w: 500, h: 400, layer: 'ground', resize: 'free', name: { pl: 'Wzgórze', en: 'Hill', de: 'Hügel' } },
};

export function sceneryName(type, lang) {
  const n = SCENERY[type]?.name; return n ? (n[lang] ?? n.en) : type;
}

/** Test trafienia w prostokąt obiektu (układ lokalny). */
export function sceneryHit(item, x, y) {
  const c = Math.cos(d2r(item.rot)), s = Math.sin(d2r(item.rot));
  const dx = x - item.x, dy = y - item.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= item.w / 2 && Math.abs(ly) <= item.h / 2;
}

// ---- 2D -------------------------------------------------------------------------

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Rysuje obiekt na ctx (transformacja świata już ustawiona). */
export function drawScenery2D(ctx, item, selected) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(d2r(item.rot));
  const { w, h } = item;
  const P = { ctx, w, h };
  (DRAW2D[item.type] || drawBox2D)(P);
  if (selected) {
    ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 3; ctx.setLineDash([10, 6]);
    ctx.strokeRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12); ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawBox2D({ ctx, w, h }) { ctx.fillStyle = '#ccc'; ctx.fillRect(-w / 2, -h / 2, w, h); }

function tree2D(ctx, r, fill, dark) {
  ctx.fillStyle = hex(dark); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hex(fill); ctx.beginPath(); ctx.arc(-r * 0.15, -r * 0.15, r * 0.7, 0, Math.PI * 2); ctx.fill();
}

function building2D({ ctx, w, h }, wall, roof, ridgeAlongX = true) {
  ctx.fillStyle = hex(wall); ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = hex(roof);
  ctx.beginPath();
  if (ridgeAlongX) { ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2, 0); ctx.lineTo(-w / 2, 0); }
  else { ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(0, -h / 2); ctx.lineTo(0, h / 2); ctx.lineTo(-w / 2, h / 2); }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.beginPath(); if (ridgeAlongX) { ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); } else { ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2); } ctx.stroke();
}

const DRAW2D = {
  conifer: ({ ctx, w }) => tree2D(ctx, w / 2, 0x3d8a4a, C.conifer),
  deciduous: ({ ctx, w }) => tree2D(ctx, w / 2, 0x6fb85a, C.leaf),
  bush: ({ ctx, w }) => tree2D(ctx, w / 2, 0x7cc45f, C.bush),
  house: (P) => building2D(P, C.wall, C.roof, P.w >= P.h),
  station: (P) => building2D(P, C.wall2, C.roof2, true),
  warehouse: ({ ctx, w, h }) => { ctx.fillStyle = hex(C.brick); ctx.fillRect(-w / 2, -h / 2, w, h); ctx.fillStyle = hex(C.roof2); ctx.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(-w / 2, -h / 2, w, h); },
  church: ({ ctx, w, h }) => { building2D({ ctx, w, h }, C.wall, C.roof2, false); ctx.fillStyle = hex(C.stone); ctx.fillRect(-w / 2, -h / 2, w, w); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.strokeRect(-w / 2, -h / 2, w, w); },
  road: ({ ctx, w, h }) => { ctx.fillStyle = hex(C.road); ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeStyle = hex(C.roadLine); ctx.lineWidth = Math.max(1.5, h * 0.05); ctx.setLineDash([30, 20]); ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke(); ctx.setLineDash([]); },
  platform: ({ ctx, w, h }) => { ctx.fillStyle = hex(C.platform); ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeStyle = hex(C.platformEdge); ctx.lineWidth = 3; ctx.strokeRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3); },
  turntable: ({ ctx, w }) => { const r = w / 2; ctx.fillStyle = hex(C.pit); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = hex(C.bridge); ctx.fillRect(-r, -14, 2 * r, 28); ctx.strokeStyle = hex(C.steel); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r, -8); ctx.lineTo(r, -8); ctx.moveTo(-r, 8); ctx.lineTo(r, 8); ctx.stroke(); },
  portal: ({ ctx, w, h }) => { ctx.fillStyle = hex(C.stone); ctx.fillRect(-w / 2, -h / 2, w, h); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, h / 2, w * 0.3, Math.PI, 0); ctx.fill(); },
  watertower: ({ ctx, w }) => { ctx.fillStyle = hex(C.roof2); ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke(); },
  pond: ({ ctx, w, h }) => { ctx.fillStyle = hex(C.water); ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,60,120,0.5)'; ctx.lineWidth = 2; ctx.stroke(); },
  hill: ({ ctx, w, h }) => { for (let i = 3; i >= 1; i--) { ctx.fillStyle = `rgba(90,140,70,${0.22 * i})`; ctx.beginPath(); ctx.ellipse(0, 0, (w / 2) * i / 3, (h / 2) * i / 3, 0, 0, Math.PI * 2); ctx.fill(); } },
};

// ---- 3D -------------------------------------------------------------------------

const mats = {};
const mat = (color, extra = {}) => (mats[color + JSON.stringify(extra)] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));

/** Buduje THREE.Group obiektu; układ: X = lokalne x, Z = lokalne y, Y = wysokość. */
export function buildScenery3D(item) {
  const g = new THREE.Group();
  (BUILD3D[item.type] || box3D)(g, item.w, item.h, item);
  g.position.set(item.x, 0, item.y);
  g.rotation.y = -d2r(item.rot);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}

function box3D(g, w, h) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 30, h), mat(0xcccccc)); m.position.y = 15; g.add(m); }

function trunk(g, r, hgt) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r, hgt, 8), mat(C.trunk)); m.position.y = hgt / 2; g.add(m); }

function gableHouse(g, w, h, wallH, wallColor, roofColor, ridgeAlongX) {
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, h), mat(wallColor)); walls.position.y = wallH / 2; g.add(walls);
  // dach dwuspadowy: pryzmat z ExtrudeGeometry trójkąta
  const span = ridgeAlongX ? h : w, len = ridgeAlongX ? w : h, roofH = span * 0.45;
  const tri = new THREE.Shape(); tri.moveTo(-span / 2 - 4, 0); tri.lineTo(span / 2 + 4, 0); tri.lineTo(0, roofH); tri.closePath();
  const geo = new THREE.ExtrudeGeometry(tri, { depth: len + 8, bevelEnabled: false });
  geo.translate(0, 0, -(len + 8) / 2);
  const roof = new THREE.Mesh(geo, mat(roofColor));
  roof.position.y = wallH;
  roof.rotation.y = ridgeAlongX ? Math.PI / 2 : 0;
  g.add(roof);
  // okna: cienkie panele
  const win = mat(C.window, { metalness: 0.3, roughness: 0.2 });
  const n = Math.max(1, Math.floor(w / 35));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    for (const z of [-h / 2 - 0.5, h / 2 + 0.5]) { const p = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 1), win); p.position.set(x, wallH * 0.55, z); g.add(p); }
  }
}

const BUILD3D = {
  conifer: (g, w) => { const r = w / 2, hgt = w * 2.2; trunk(g, r * 0.15, hgt * 0.25); const cone = new THREE.Mesh(new THREE.ConeGeometry(r, hgt * 0.8, 10), mat(C.conifer)); cone.position.y = hgt * 0.2 + hgt * 0.4; g.add(cone); },
  deciduous: (g, w) => { const r = w / 2, hgt = w * 1.6; trunk(g, r * 0.14, hgt * 0.45); const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat(C.leaf)); crown.position.y = hgt * 0.45 + r * 0.8; crown.scale.y = 0.9; g.add(crown); },
  bush: (g, w) => { const r = w / 2; const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(C.bush)); b.position.y = r * 0.7; b.scale.y = 0.75; g.add(b); },
  house: (g, w, h) => gableHouse(g, w, h, Math.min(w, h) * 0.55, C.wall, C.roof, w >= h),
  station: (g, w, h) => { gableHouse(g, w, h, 60, C.wall2, C.roof2, true); const canopy = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 2, 40), mat(C.roof2)); canopy.position.set(0, 38, h / 2 + 18); g.add(canopy); for (const x of [-w * 0.4, 0, w * 0.4]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 38, 6), mat(C.steel)); post.position.set(x, 19, h / 2 + 34); g.add(post); } },
  warehouse: (g, w, h) => { const wallH = 55; const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, h), mat(C.brick)); walls.position.y = wallH / 2; g.add(walls); const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 6, 3, h + 6), mat(C.roof2)); roof.position.y = wallH + 1.5; g.add(roof); const door = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), mat(0x3b3f44)); door.position.set(0, 17.5, h / 2 + 0.5); g.add(door); },
  church: (g, w, h) => { gableHouse(g, w, h - w, 70, C.wall, C.roof2, false); g.children.forEach((m) => { m.position.z += w / 2; }); const tower = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 150, w * 0.8), mat(C.stone)); tower.position.set(0, 75, -h / 2 + w / 2); g.add(tower); const spire = new THREE.Mesh(new THREE.ConeGeometry(w * 0.55, 70, 4), mat(C.roof2)); spire.position.set(0, 185, -h / 2 + w / 2); spire.rotation.y = Math.PI / 4; g.add(spire); },
  road: (g, w, h) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, h), mat(C.road)); m.position.y = 0.6; g.add(m); const n = Math.floor(w / 50); for (let i = 0; i < n; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, Math.max(1.5, h * 0.04)), mat(C.roadLine)); d.position.set(-w / 2 + 25 + i * 50, 1.4, 0); g.add(d); } },
  platform: (g, w, h) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 10, h), mat(C.platform)); m.position.y = 5; g.add(m); const e = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 3), mat(C.platformEdge)); e.position.set(0, 10.3, h / 2 - 1.5); g.add(e); },
  turntable: (g, w) => { const r = w / 2; const pit = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 4, 40), mat(C.pit)); pit.position.y = -2; g.add(pit); const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 2, 8, 40), mat(C.stone)); ring.rotation.x = Math.PI / 2; ring.position.y = 1; g.add(ring); const bridge = new THREE.Mesh(new THREE.BoxGeometry(2 * r - 6, 6, 28), mat(C.bridge)); bridge.position.y = 3; g.add(bridge); for (const z of [-8.25, 8.25]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(2 * r - 6, 2.5, 1.2), mat(C.steel, { metalness: 0.8, roughness: 0.35 })); rail.position.set(0, 7.2, z); g.add(rail); } },
  portal: (g, w, h) => { const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 60, h), mat(C.stone)); wall.position.y = 30; g.add(wall); const hole = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.3, h + 2, 16, 1, false, 0, Math.PI), mat(0x111111)); hole.rotation.x = Math.PI / 2; hole.rotation.z = Math.PI / 2; hole.position.y = 22; g.add(hole); },
  watertower: (g, w) => { const r = w / 2; const legs = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.5, 80, 8), mat(C.brick)); legs.position.y = 40; g.add(legs); const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 40, 16), mat(C.roof2)); tank.position.y = 100; g.add(tank); const cap = new THREE.Mesh(new THREE.ConeGeometry(r + 2, 16, 16), mat(C.roof)); cap.position.y = 128; g.add(cap); },
  pond: (g, w, h) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32), mat(C.water, { metalness: 0.2, roughness: 0.25 })); m.scale.set(w / 2, 1.5, h / 2); m.position.y = 0.75; g.add(m); },
  hill: (g, w, h) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.hill)); m.scale.set(w / 2, Math.min(w, h) * 0.35, h / 2); g.add(m); },
};
