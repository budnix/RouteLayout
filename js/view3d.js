// Podgląd 3D układu w three.js. Jednostka sceny = mm. Render na żądanie.

import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { GAUGE, BY_ID } from './catalog.js';
import { buildScenery3D } from './scenery.js';

const RAIL_H = 2.5;          // wysokość szyny (Code 100 ≈ 2,5 mm)
const RAIL_W = 1.2;
const SLEEPER = { l: 30, w: 3.2, h: 1.8, pitch: 7.6 };
const BALLAST_W = 34;
const BALLAST_H = 1.4;

export class View3D {
  constructor(container, layout) {
    this.container = container;
    this.layout = layout;
    this.dirty = true;
    this.rebuildNeeded = true;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe7ef);
    this.scene.fog = new THREE.Fog(0xdfe7ef, 4000, 12000);

    this.camera = new THREE.PerspectiveCamera(45, 1, 5, 30000);
    this.camera.position.set(900, 1100, 1400);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => this.invalidate());

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(1500, 2500, 1000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 1.5;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.trackGroup = new THREE.Group();
    this.scene.add(this.trackGroup);
    this.sceneryGroup = new THREE.Group();
    this.scene.add(this.sceneryGroup);
    this.boardMesh = null;

    this.mats = {
      rail: new THREE.MeshStandardMaterial({ color: 0x8c8c8c, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide }),
      sleeper: new THREE.MeshStandardMaterial({ color: 0x4a3a2b, roughness: 0.95 }),
      ballast: new THREE.MeshStandardMaterial({ color: 0x9a9083, roughness: 1, side: THREE.DoubleSide }),
      board: new THREE.MeshStandardMaterial({ color: 0x5f8f4a, roughness: 1 }),
      pier: new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.95 }),
      pit: new THREE.MeshStandardMaterial({ color: 0x7a7570, roughness: 1 }),
      edge: new THREE.MeshStandardMaterial({ color: 0xa87c4f, roughness: 0.9 }),
      selected: new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0x552200, roughness: 0.5, side: THREE.DoubleSide }),
    };

    this.selectedUid = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    layout.onChange((kind) => {
      if (kind === 'drag') { clearTimeout(this._t); this._t = setTimeout(() => { this.rebuildNeeded = true; this.invalidate(); }, 120); return; }
      this.rebuildNeeded = true; this.invalidate();
      // pusty układ (nowy / wyczyszczony / wczytany inny blat): kamera na blat
      if (!layout.pieces.length) this.fit();
    });
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  invalidate() { this.dirty = true; }
  setSelected(uid) { this.selectedUid = uid; this.rebuildNeeded = true; this.invalidate(); }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  _loop() {
    requestAnimationFrame(this._loop);
    if (this.container.offsetParent === null && !this.container.classList.contains('force-render')) return; // ukryty
    if (this.rebuildNeeded) { this.rebuild(); this.rebuildNeeded = false; this.dirty = true; }
    const moved = this.controls.update();
    if (this.dirty || moved) { this.renderer.render(this.scene, this.camera); this.dirty = false; }
  }

  /** Kamera nad całym układem. */
  fit() {
    const b = this.layout.bounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 600);
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx + size * 0.35, size * 0.9, cz + size * 0.9);
    this.controls.update();
    this.invalidate();
  }

  rebuild() {
    // wyczyść
    for (const m of this.trackGroup.children) { m.geometry?.dispose(); }
    this.trackGroup.clear();

    // blat
    const { w, h } = this.layout.board;
    if (this.boardMesh) { this.scene.remove(this.boardMesh); this.boardMesh.children.forEach((m) => m.geometry.dispose()); }
    this.mats.board.side = THREE.DoubleSide;
    const board = new THREE.Group();
    // górna płyta jako kształt z otworami pod stawami (widać wydrążone niecki)
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(w, 0), new THREE.Vector2(w, h), new THREE.Vector2(0, h)]);
    for (const it of this.layout.scenery) {
      if (it.type !== 'pond') continue;
      const hole = new THREE.Path();
      hole.absellipse(it.x, it.y, it.w / 2 - 0.5, it.h / 2 - 0.5, 0, Math.PI * 2, false, it.rot * Math.PI / 180);
      shape.holes.push(hole);
    }
    const topGeo = new THREE.ShapeGeometry(shape, 24);
    topGeo.rotateX(Math.PI / 2);            // płaszczyzna XY -> XZ (y kształtu = z sceny)
    const top = new THREE.Mesh(topGeo, this.mats.board);
    top.receiveShadow = true;
    board.add(top);
    // korpus blatu poniżej płyty bez wierzchu (żeby niecki stawów były widoczne): 4 ściany + spód
    const T = 12;
    for (const [bx, by, bz, sx, sz] of [[w / 2, -T / 2, 1, w, 2], [w / 2, -T / 2, h - 1, w, 2], [1, -T / 2, h / 2, 2, h], [w - 1, -T / 2, h / 2, 2, h]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, T, sz), this.mats.board); wall.position.set(bx, by, bz); board.add(wall);
    }
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(w, 1, h), this.mats.board); bottom.position.set(w / 2, -T + 0.5, h / 2); board.add(bottom);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 24, 30, h + 24), this.mats.edge);
    frame.position.set(w / 2, -27, h / 2);
    board.add(frame);
    this.boardMesh = board;
    this.scene.add(board);
    this.sun.target.position.set(w / 2, 0, h / 2);
    const s = Math.max(w, h) * 0.7;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 100, far: 8000 });
    this.sun.position.set(w / 2 + 1500, 2500, h / 2 + 1000);
    this.sun.shadow.camera.updateProjectionMatrix();

    // tory
    const segs = this.layout.worldSegments(6);
    const sleeperCount = segs.reduce((n, s) => n + Math.ceil(polyLength(s.pts) / SLEEPER.pitch), 0);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(SLEEPER.w, SLEEPER.h, SLEEPER.l), this.mats.sleeper, Math.max(1, sleeperCount));
    sleepers.castShadow = true; sleepers.receiveShadow = true;
    let si = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);

    const railGeos = [], ballastGeos = [], selGeos = [];
    for (const s of segs) {
      const pts = s.pts;
      const selected = s.piece.uid === this.selectedUid;
      // podsypka
      ballastGeos.push(ribbon(pts, BALLAST_W, BALLAST_H, 0));
      // szyny
      for (const side of [-1, 1]) {
        const g = ribbon(pts, RAIL_W, RAIL_H, side * GAUGE / 2, BALLAST_H + SLEEPER.h);
        (selected ? selGeos : railGeos).push(g);
      }
      // podkłady
      const L = polyLength(pts);
      const n = Math.ceil(L / SLEEPER.pitch);
      for (let i = 0; i < n && si < sleeperCount; i++) {
        const { p, t } = pointAt(pts, (i + 0.5) * SLEEPER.pitch);
        pos.set(p[0], (p[2] || 0) + BALLAST_H + SLEEPER.h / 2, p[1]);
        q.setFromAxisAngle(up, -Math.atan2(t[1], t[0]));
        m4.compose(pos, q, one);
        sleepers.setMatrixAt(si++, m4);
      }
    }
    sleepers.count = si;
    sleepers.instanceMatrix.needsUpdate = true;
    this.trackGroup.add(sleepers);

    const addMerged = (geos, mat) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.trackGroup.add(mesh);
      geos.forEach((g) => g.dispose());
    };
    addMerged(ballastGeos, this.mats.ballast);
    addMerged(railGeos, this.mats.rail);
    addMerged(selGeos, this.mats.selected);

    // filary pod torem uniesionym ponad blat
    const pierGeos = [];
    for (const s of segs) {
      const L = polyLength(s.pts);
      for (let d = 50; d < L; d += 100) {
        const { p } = pointAt(s.pts, d);
        const z = p[2] || 0;
        if (z < 8) continue;
        const g = new THREE.BoxGeometry(16, z, 26);
        g.translate(p[0], z / 2, p[1]);
        pierGeos.push(g);
      }
    }
    addMerged(pierGeos, this.mats.pier);

    // obrotnice: niecka, pierścień (most rysowany jak zwykły tor)
    for (const tt of this.layout.pieces) {
      if (!BY_ID[tt.id].turntable) continue;
      const z = tt.z || 0;
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(tt.r, tt.r, 4, 48), this.mats.pit);
      pit.position.set(tt.x, z - 1.4, tt.y); pit.receiveShadow = true; this.trackGroup.add(pit);   // wierzch 0,6 mm nad blatem – bez z-fightingu
      const ring = new THREE.Mesh(new THREE.TorusGeometry(tt.r, 2.5, 8, 48), this.mats.edge);
      ring.rotation.x = Math.PI / 2; ring.position.set(tt.x, z + 1, tt.y); this.trackGroup.add(ring);
    }

    // sceneria
    this.sceneryGroup.traverse((m) => m.geometry?.dispose());
    this.sceneryGroup.clear();
    for (const it of this.layout.scenery) this.sceneryGroup.add(buildScenery3D(it));
  }

  dispose() { this.renderer.dispose(); }
}

// ---- pomocnicze geometryczne ------------------------------------------------

function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }

/** Punkt i styczna w odległości d wzdłuż łamanej. */
function pointAt(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const L = Math.hypot(dx, dy);
    if (acc + L >= d || i === pts.length - 1) {
      const t = L ? Math.min(1, Math.max(0, (d - acc) / L)) : 0;
      const z0 = pts[i - 1][2] || 0, z1 = pts[i][2] || 0;
      return { p: [pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t, z0 + (z1 - z0) * t], t: [dx / (L || 1), dy / (L || 1)] };
    }
    acc += L;
  }
  return { p: pts[0], t: [1, 0] };
}

/** Prostokątna "wstęga" o szerokości w i wysokości h wzdłuż łamanej, przesunięta bocznie o offset, podniesiona o y0. */
function ribbon(pts, w, h, offset, y0 = 0) {
  const n = pts.length;
  const verts = [], idx = [];
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    const nx = -ty, ny = tx; // normalna w płaszczyźnie
    const cx = pts[i][0] + nx * offset, cz = pts[i][1] + ny * offset;
    const yb = y0 + (pts[i][2] || 0);
    // 4 wierzchołki przekroju: dół-lewo, dół-prawo, góra-prawo, góra-lewo
    const hw = w / 2;
    verts.push(cx - nx * hw, yb, cz - ny * hw, cx + nx * hw, yb, cz + ny * hw, cx + nx * hw, yb + h, cz + ny * hw, cx - nx * hw, yb + h, cz - ny * hw);
    normals.push(-nx, 0, -ny, nx, 0, ny, nx, 0, ny, -nx, 0, -ny);
    if (i) {
      const p = (i - 1) * 4, c = i * 4;
      // góra
      idx.push(p + 3, p + 2, c + 2, p + 3, c + 2, c + 3);
      // boki
      idx.push(p + 1, p + 2, c + 2, p + 1, c + 2, c + 1);
      idx.push(p + 3, p + 0, c + 0, p + 3, c + 0, c + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Minimalne łączenie geometrii (tylko position + index) – bez BufferGeometryUtils. */
function mergeGeometries(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3), idx = new (vCount > 65535 ? Uint32Array : Uint16Array)(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}
