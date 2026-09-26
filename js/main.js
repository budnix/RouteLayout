import { CATALOG, BY_ID, sampleSegment, SYSTEMS, DEFAULT_SYSTEM, toSystem } from './catalog.js';
import { Layout, norm } from './layout.js';
import { Editor2D } from './editor2d.js';
import { View3D } from './view3d.js';
import { t, pieceName, applyDom, setLang, getLang, LANGS } from './i18n.js';
import { fitStrokes, normalizeStroke } from './fitter.js';
import { closeGap, pickPartner } from './closer.js';
import { checkLayout } from './checks.js';
import { Train, toggleSwitch } from './train.js';
import { printLayout, buildPrintView, removePrintView } from './print.js';
import { encodeShare, decodeShare, shareUrl } from './share.js';
import { SCENERY, SCENERY_GROUPS, sceneryName, drawScenery2D } from './scenery.js';

const $ = (id) => document.getElementById(id);

// ---- błędy: widoczny toast zamiast cichej awarii (iPad nie ma konsoli) ----
let toastTimer = null;
function toast(msg, ms = 8000) {
  const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
const errMsg = (e) => (e && (e.message || e.reason?.message || String(e.reason || e))) || 'unknown';
window.addEventListener('error', (e) => toast(t('error.generic', { msg: errMsg(e.error || e) + (e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno}` : '') })));
window.addEventListener('unhandledrejection', (e) => toast(t('error.generic', { msg: errMsg(e) })));
window.addEventListener('routelayout:error', (e) => toast(t('error.generic', { msg: errMsg(e.detail) })));

const layout = new Layout();
const editor = new Editor2D($('canvas2d'), layout);
const view3d = new View3D($('view3d'), layout);

// ---- paleta: zakładki + lista ---------------------------------------------------
const selEntry = $('sel-entry'), palList = $('pal-list'), palTabs = $('pal-tabs'), selSystem = $('sel-system');
let system = (() => { try { const v = localStorage.getItem('routelayout.system'); return SYSTEMS[v] ? v : DEFAULT_SYSTEM; } catch { return DEFAULT_SYSTEM; } })();
function fillSystems() {
  selSystem.innerHTML = '';
  for (const [key, def] of Object.entries(SYSTEMS)) selSystem.append(new Option(def.name[getLang()] || def.name.en, key));
  selSystem.value = system;
}
selSystem.addEventListener('change', () => { system = selSystem.value; try { localStorage.setItem('routelayout.system', system); } catch { /* ignoruj */ } buildList(); });
/** Mapuje elementy (np. z dopasowania szkicu, domykania) na wybrany system torów. */
const toCurrentSystem = (pieces) => pieces.map((p) => ({ ...p, id: toSystem(p.id, system) }));
let palTab = (() => { try { return localStorage.getItem('routelayout.tab') || 'piko'; } catch { return 'piko'; } })();
const PIKO_SECTIONS = ['straight', 'curve', 'turnout', 'crossing', 'flex'];

/** Miniatura kształtu elementu: segmenty geometrii przeskalowane do 60×34. */
function pieceIcon(def) {
  const geo = def.geo;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geo.segments.map((seg) => sampleSegment(seg, 12));
  for (const poly of polys) for (const [x, y] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const sc = Math.min(54 / w, 28 / h, 0.25);
  const ox = 30 - ((minX + maxX) / 2) * sc, oy = 17 - ((minY + maxY) / 2) * sc;
  const d = polys.map((poly) => poly.map(([x, y], k) => `${k ? 'L' : 'M'}${(ox + x * sc).toFixed(1)} ${(oy + y * sc).toFixed(1)}`).join(' ')).join(' ');
  return `<svg class="pal-icon" viewBox="0 0 60 34" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** Miniatura obiektu scenerii: rysowana funkcją 2D na małym canvasie. */
function sceneryIcon(type) {
  const def = SCENERY[type];
  const c = document.createElement('canvas'); c.width = 120; c.height = 68; c.className = 'pal-icon';
  const ctx = c.getContext('2d');
  const sc = Math.min(100 / def.w, 52 / def.h);
  ctx.setTransform(sc, 0, 0, sc, 60, 34);
  drawScenery2D(ctx, { type, x: 0, y: 0, rot: 0, w: def.w, h: def.h }, false);
  return c;
}

const fmt = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');
function pieceMeta(def) {
  if (def.turntable) return '⌀ 320 mm';
  if (def.group === 'curve') return t('meta.arc', { r: fmt(def.r), a: fmt(def.deg) });
  if (def.group === 'turnout' || def.group === 'crossing') {
    const seg = def.geo.segments[0];
    const L = seg.type === 'line' ? Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) : 0;
    const arc = def.geo.segments.find((g) => g.type === 'arc');
    const a = arc ? Math.abs(arc.a1 - arc.a0) : (def.code.startsWith('K') ? +def.code.slice(1) : 15);
    return L ? t('meta.turnout', { L: fmt(L), a: fmt(a) }) : t('meta.arc', { r: fmt(arc.r), a: fmt(a) });
  }
  return t('meta.len', { L: fmt(def.len || 0) });
}

const ic = (name) => `<svg class="ic"><use href="#${name}"/></svg>`;

const recent = (() => { try { return JSON.parse(localStorage.getItem('routelayout.recent')) || []; } catch { return []; } })();
function noteRecent(key) {
  const i = recent.indexOf(key); if (i >= 0) recent.splice(i, 1);
  recent.unshift(key); recent.splice(6);
  try { localStorage.setItem('routelayout.recent', JSON.stringify(recent)); } catch { /* ignoruj */ }
  const st = palList.scrollTop; buildList(); palList.scrollTop = st;   // sekcja „ostatnio używane” na bieżąco, bez skoku listy
}
function buildList() {
  palList.innerHTML = '';
  palTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === palTab));
  $('entry-row').classList.toggle('hidden', palTab === 'scenery');
  $('system-row').classList.toggle('hidden', palTab !== 'piko');
  const section = (label) => { const h = document.createElement('div'); h.className = 'pal-section'; h.textContent = label; palList.append(h); };
  // ostatnio używane (dla bieżącej zakładki)
  const recentHere = recent.filter((k) => (palTab === 'scenery' ? !!SCENERY[k] : BY_ID[k] && (palTab === 'accessory' ? BY_ID[k].group === 'accessory' : BY_ID[k].group !== 'accessory'))).map((k) => (BY_ID[k] && palTab === 'piko' ? toSystem(k, system) : k));
  if (recentHere.length) { section(t('pal.recent')); for (const k of [...new Set(recentHere)]) palList.append(SCENERY[k] ? sceneryRow(k) : pieceRow(BY_ID[k])); }
  if (palTab === 'scenery') {
    for (const g of SCENERY_GROUPS) {
      section(t('group.' + g));
      for (const [type, def] of Object.entries(SCENERY)) if (def.group === g) palList.append(sceneryRow(type));
    }
    return;
  }
  const groups = palTab === 'piko' ? PIKO_SECTIONS : ['accessory'];
  for (const g of groups) {
    const items = CATALOG.filter((p) => p.group === g && (palTab !== 'piko' || p.system === system));
    if (!items.length) continue;
    if (palTab === 'piko') section(t('group.' + g));
    for (const def of items) palList.append(pieceRow(def));
  }
}
function sceneryRow(type) {
  const def = SCENERY[type];
  const row = document.createElement('div');
  row.className = 'pal-item'; row.dataset.type = type; row.setAttribute('role', 'listitem');
  row.append(sceneryIcon(type));
  row.insertAdjacentHTML('beforeend', `<div class="pal-text"><div class="pal-title">${sceneryName(type, getLang())}</div><div class="pal-desc">${t('meta.size', { w: def.w, h: def.h })}</div></div>`);
  row.addEventListener('click', () => { noteRecent(type); editor.addScenery(type); });
  return row;
}
function pieceRow(def) {
  const row = document.createElement('div');
  row.className = 'pal-item'; row.dataset.id = def.id; row.setAttribute('role', 'listitem');
  row.innerHTML = `${pieceIcon(def)}<div class="pal-text"><div class="pal-title">${def.code}<span class="pal-id">${def.id}</span></div><div class="pal-desc">${pieceName(def)}${def.verified === false ? ' ' + t('pal.unverified') : ''}</div></div><div class="pal-meta">${pieceMeta(def)}</div>`;
  const add = (entry) => { noteRecent(def.base || def.id); editor.addPiece(def.id, entry); };
  if (def.group === 'curve') {
    const acts = document.createElement('div'); acts.className = 'pal-actions';
    acts.innerHTML = `<button type="button" data-entry="0" title="${t('pal.left')}">${ic('i-rotate-ccw')}</button><button type="button" data-entry="1" title="${t('pal.rightBtn')}">${ic('i-rotate-cw')}</button>`;
    acts.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); add(+b.dataset.entry); }));
    row.append(acts);
  }
  row.addEventListener('click', () => add(def.group === 'curve' ? 0 : +selEntry.value || 0));
  return row;
}

function fillEntry() {
  const cur = selEntry.value || '0';
  selEntry.innerHTML = '';
  const labels = ['port.start', 'port.n', 'port.n', 'port.n'];
  labels.forEach((key, i) => selEntry.append(new Option(i === 0 ? `0: ${t('port.start')}` : `${i}: ${t('port.generic', { i })}`, String(i))));
  selEntry.value = cur;
}
palTabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  palTab = b.dataset.tab; try { localStorage.setItem('routelayout.tab', palTab); } catch { /* ignoruj */ }
  buildList();
});
fillSystems();
fillEntry();
buildList();

/** Programowe wstawianie (testy, konsola): tor po id z portem wejściowym albo obiekt scenerii po typie. */
function insert(idOrType, entry = 0) { return SCENERY[idOrType] ? editor.addScenery(idOrType) : editor.addPiece(idOrType, entry); }

// chowanie panelu bocznego (szerokie ekrany)
function setSide(collapsed) {
  document.body.classList.toggle('side-collapsed', collapsed);
  try { localStorage.setItem('routelayout.side', collapsed ? '1' : '0'); } catch { /* ignoruj */ }
  requestAnimationFrame(() => { editor.resize(); view3d.resize(); });
}
$('btn-side').addEventListener('click', () => setSide(!document.body.classList.contains('side-collapsed')));
try { if (localStorage.getItem('routelayout.side') === '1') setSide(true); } catch { /* ignoruj */ }

// zwijanie palety na telefonie
$('palette-grip').addEventListener('click', () => { $('palette').classList.toggle('collapsed'); setTimeout(() => { editor.resize(); view3d.resize(); }, 220); });

// ---- pasek górny -----------------------------------------------------------
const ws = document.querySelector('.workspace');
function setMode(m) {
  ws.className = `workspace mode-${m}`;
  for (const t of ['2d', '3d', 'split']) $(`tab-${t}`).classList.toggle('active', t === m);
  requestAnimationFrame(() => { editor.resize(); view3d.resize(); if (m !== '2d') view3d.fit(); });
  try { localStorage.setItem('routelayout.mode', m); } catch { /* ignoruj */ }
}
$('tab-2d').addEventListener('click', () => setMode('2d'));
$('tab-3d').addEventListener('click', () => setMode('3d'));
$('tab-split').addEventListener('click', () => setMode('split'));
$('btn-new').addEventListener('click', () => {
  if (!layout.pieces.length || confirm(t('confirm.new'))) {
    editor.selected = null; editor.cursor = null;
    layout.reset(t('default.name'));
    editor.emit('select'); editor.fit(); view3d.fit();
  }
});
$('btn-undo').addEventListener('click', () => layout.undo());
$('btn-redo').addEventListener('click', () => layout.redo());

$('btn-fit2d').addEventListener('click', () => editor.fit());
$('btn-zoom-in').addEventListener('click', () => editor.zoomAt(editor.canvas.clientWidth / 2, editor.canvas.clientHeight / 2, 1.25));
$('btn-zoom-out').addEventListener('click', () => editor.zoomAt(editor.canvas.clientWidth / 2, editor.canvas.clientHeight / 2, 0.8));
$('btn-fit3d').addEventListener('click', () => view3d.fit());

// hak diagnostyczny (testy, konsola)
window.__routelayout = { layout, editor, view3d, insert, closeFromCursor, problems: () => problems };

// ---- tryb rysowania ----------------------------------------------------------
const gridPrefs = (() => { try { return JSON.parse(localStorage.getItem('routelayout.grid')) || {}; } catch { return {}; } })();
const aidGrid = { enabled: !!gridPrefs.enabled, size: +gridPrefs.size || 50 };
function applyGrid() {
  editor.setAidGrid(aidGrid.enabled, aidGrid.size);
  $('chk-grid').checked = aidGrid.enabled; $('chk-grid-menu').checked = aidGrid.enabled; $('in-grid').value = aidGrid.size;
  try { localStorage.setItem('routelayout.grid', JSON.stringify(aidGrid)); } catch { /* ignoruj */ }
}
$('chk-grid').addEventListener('change', (e) => { aidGrid.enabled = e.target.checked; applyGrid(); });
$('chk-grid-menu').addEventListener('change', (e) => { aidGrid.enabled = e.target.checked; applyGrid(); });
$('in-grid').addEventListener('change', (e) => { aidGrid.size = Math.min(500, Math.max(5, +e.target.value || 50)); applyGrid(); });
applyGrid();

// poprawianie rysunku (normalizacja) – domyślnie włączone
const fixPref = { on: (() => { try { return localStorage.getItem('routelayout.fix') !== '0'; } catch { return true; } })() };
function applyFixPref() { editor.normalizer = fixPref.on ? (pts) => normalizeStroke(pts, layout) : null; $('chk-fix').checked = fixPref.on; }
$('chk-fix').addEventListener('change', (e) => { fixPref.on = e.target.checked; try { localStorage.setItem('routelayout.fix', fixPref.on ? '1' : '0'); } catch { /* ignoruj */ } applyFixPref(); });
applyFixPref();

function setDrawMode(on) {
  editor.setMode(on ? 'draw' : 'edit');
  $('btn-draw').classList.toggle('active', on);
  $('draw-bar').classList.toggle('hidden', !on);
  $('canvas2d').classList.toggle('drawing', on);
  $('hint').textContent = t(on ? 'draw.hint' : 'pal.hint');
  if (on) { editor.selected = null; editor.emit('select'); }
}
$('btn-draw').addEventListener('click', () => setDrawMode(editor.mode !== 'draw'));
$('btn-undo-stroke').addEventListener('click', () => editor.undoStroke());
$('btn-clear-sketch').addEventListener('click', () => editor.clearSketch());
$('btn-finish').addEventListener('click', finishDrawing);
function finishDrawing() {
  editor.finishStroke();   // kreska w toku (brak pointerup) nie może przepaść
  if (!editor.strokes.length) { toast(t('draw.empty'), 4000); return; }
  let result;
  try { result = fitStrokes(editor.strokes, layout, { normalize: fixPref.on }); }
  catch (err) { console.error(err); toast(t('error.generic', { msg: errMsg(err) })); return; }
  window.__routelayout.lastFit = result;
  const { pieces } = result;
  if (!pieces.length) { toast(t('draw.none'), 5000); return; }
  const added = layout.addMany(toCurrentSystem(pieces));
  editor.clearSketch();
  setDrawMode(false);
  autoClose(added);
  editor.selected = added[added.length - 1];
  const open = layout.openPorts().find((p) => p.piece === editor.selected);
  editor.cursor = open ? { uid: editor.selected.uid, idx: open.idx } : null;
  editor.emit('select'); editor.emit('cursor'); editor.draw();
}
// przycisk zawsze aktywny – brak kresek tłumaczy toast, a nie martwy przycisk

// ---- kontrola wykonalności --------------------------------------------------------
let problems = [];
let checkTimer = null;
function runChecks() {
  try { problems = checkLayout(layout); } catch (err) { console.error('checks', err); problems = []; }
  editor.problems = problems;
  const badge = $('menu-badge');
  badge.textContent = String(problems.length);
  badge.classList.toggle('hidden', problems.length === 0);
  editor.draw();
}
layout.onChange((kind) => { if (kind !== 'change') return; clearTimeout(checkTimer); checkTimer = setTimeout(runChecks, 120); });
function renderProblems() {
  const box = $('problems'); box.innerHTML = '';
  const cnt = $('problems-count'); cnt.textContent = problems.length ? String(problems.length) : '✓'; cnt.classList.toggle('ok', !problems.length);
  if (!problems.length) { box.innerHTML = `<div class="none">${t('prob.none')}</div>`; return; }
  for (const pr of problems) {
    const row = document.createElement('div');
    row.className = 'prob' + (pr.type === 'edge' || pr.type === 'grade' ? ' warn' : '');
    row.innerHTML = `<span class="dot"></span><span>${t('prob.' + pr.type, pr.params)}</span>`;
    row.addEventListener('click', () => { menu.classList.add('hidden'); editor.selected = pr.pieces[0]; editor.selectedScenery = null; editor.emit('select'); centerOn(pr.x, pr.y); });
    box.append(row);
  }
}
function centerOn(x, y) {
  const W = editor.canvas.clientWidth, H = editor.canvas.clientHeight;
  editor.view.scale = Math.max(editor.view.scale, 0.6);
  editor.view.ox = W / 2 - x * editor.view.scale; editor.view.oy = H / 2 - y * editor.view.scale;
  editor.draw();
}

// ---- zaznaczanie prostokątem, wymiary, link ---------------------------------------------
$('btn-marquee').addEventListener('click', () => {
  if (editor.mode === 'draw') setDrawMode(false);
  if (editor.mode === 'train') setTrainMode(false);
  editor.setMode(editor.mode === 'marquee' ? 'edit' : 'marquee');
});
editor.on((kind) => { if (kind === 'mode') $('btn-marquee').classList.toggle('active', editor.mode === 'marquee'); });
const dimsPref = (() => { try { return localStorage.getItem('routelayout.dims') === '1'; } catch { return false; } })();
function setDims(on) { editor.dims = on; $('btn-dims').classList.toggle('active', on); try { localStorage.setItem('routelayout.dims', on ? '1' : '0'); } catch { /* ignoruj */ } editor.draw(); }
$('btn-dims').addEventListener('click', () => setDims(!editor.dims));
setDims(dimsPref);

$('btn-share').addEventListener('click', async () => {
  const url = shareUrl(await encodeShare(layout.toJSON()));
  try { await navigator.clipboard.writeText(url); toast(t('share.copied'), 4000); }
  catch { window.prompt(t('menu.share'), url); }
});
async function loadFromHash() {
  const obj = await decodeShare(location.hash);
  if (!obj) return false;
  try { layout.load(obj); history.replaceState(null, '', location.pathname + location.search); editor.fit(); toast(t('share.loaded'), 4000); return true; }
  catch (err) { toast(t('error.load') + errMsg(err)); return false; }
}
window.addEventListener('hashchange', loadFromHash);

// ---- jazda próbna ---------------------------------------------------------------------
const train = new Train(layout);
editor.train = train;
Object.assign(window.__routelayout, { train, setTrainMode, buildPrintView, removePrintView, shoppingList: () => shoppingList(), setSystem: (v) => { selSystem.value = v; selSystem.dispatchEvent(new Event('change')); }, getSystem: () => system, encodeShare, decodeShare, loadFromHash, recent });
let trainRaf = null, trainLast = 0;
function trainFrame(ts) {
  trainRaf = requestAnimationFrame(trainFrame);
  const dt = Math.min(0.1, (ts - trainLast) / 1000 || 0); trainLast = ts;
  if (train.running) train.step(dt);
  editor.draw();
  view3d.setTrain(train.pose(), train.carPoses());
  if (!train.running) { cancelAnimationFrame(trainRaf); trainRaf = null; updatePlayIcon(); }
}
function updatePlayIcon() { $('btn-play').innerHTML = `<svg class="ic"><use href="#${train.running ? 'i-pause' : 'i-play'}"/></svg>`; }
function updateSpeedLabel() { const v = train.speed; $('speed-label').textContent = t('train.speed', { v, kmh: Math.round(v * 87 * 3.6 / 1000) }); }
function setTrainMode(on) {
  if (on && !layout.pieces.length) { toast(t('train.none'), 4000); return; }
  if (on) {
    if (editor.mode === 'draw') setDrawMode(false);
    const cur = editor.cursorPort();
    const start = cur ? [cur.piece, cur.idx] : [layout.pieces[0], 0];
    if (!train.pos || !layout.pieces.includes(train.pos.piece)) train.place(start[0], start[1]);
    editor.selected = null; editor.selectedScenery = null; editor.emit('select');
  } else { train.running = false; if (trainRaf) { cancelAnimationFrame(trainRaf); trainRaf = null; } view3d.setTrain(null); }
  editor.setMode(on ? 'train' : 'edit');
  $('btn-train').classList.toggle('active', on);
  $('train-bar').classList.toggle('hidden', !on);
  $('hint').textContent = t(on ? 'train.hint' : 'pal.hint');
  updatePlayIcon(); updateSpeedLabel();
  editor.draw(); view3d.setTrain(on ? train.pose() : null, on ? train.carPoses() : []);
}
$('btn-train').addEventListener('click', () => setTrainMode(editor.mode !== 'train'));
$('btn-play').addEventListener('click', () => {
  if (!train.pos) return;
  if (train.running) { train.running = false; }
  else {
    // stoi na ślepym końcu: zawróć
    const exit = layout.portOf(train.pos.piece, train.pos.route.exit);
    if (train.pos.s >= train.pos.route.len - 0.01 && !(exit && exit.mate)) train.reverse();
    train.running = true; trainLast = performance.now(); if (!trainRaf) trainRaf = requestAnimationFrame(trainFrame);
  }
  updatePlayIcon();
});
$('btn-reverse').addEventListener('click', () => { train.reverse(); editor.draw(); view3d.setTrain(train.pose(), train.carPoses()); });
$('in-speed').addEventListener('input', (e) => { train.speed = +e.target.value; updateSpeedLabel(); });
editor.on((kind, _ed, piece) => { if (kind !== 'switch' || !piece) return; if (toggleSwitch(piece) !== null) { layout.save(); editor.draw(); } });
layout.onChange((kind) => { if (kind === 'change' && editor.mode === 'train' && train.pos && !layout.pieces.includes(train.pos.piece)) { train.pos = null; if (layout.pieces.length) train.place(layout.pieces[0], 0); } });

// ---- domykanie pętli ----------------------------------------------------------
const listIds = (pieces) => pieces.map((p) => BY_ID[p.id].code).join(' + ');
function closeFromCursor() {
  const A = editor.cursorPort();
  if (!A) return;
  const B = pickPartner(layout, A);
  if (!B) { toast(t('close.noPartner'), 5000); return; }
  const r = closeGap(A, B);
  if (!r.ok) { toast(t('close.fail', { d: r.error.d.toFixed(1), da: r.error.da.toFixed(1) }), 8000); return; }
  layout.addMany(toCurrentSystem(r.pieces));
  editor.cursor = null; editor.selected = null; editor.emit('select'); editor.emit('cursor'); editor.draw();
  toast(t('close.ok', { list: listIds(r.pieces), d: r.error.d.toFixed(2) }), 5000);
}
$('btn-close').addEventListener('click', closeFromCursor);
editor.on((kind) => { if (kind === 'cursor' || kind === 'mode') $('btn-close').classList.toggle('hidden', !editor.cursorPort() || editor.mode === 'draw'); });
layout.onChange(() => $('btn-close').classList.toggle('hidden', !editor.cursorPort() || editor.mode === 'draw'));

/** Po szkicu: jeśli dwa otwarte końce nowych elementów są blisko i naprzeciw – domknij. */
function autoClose(added) {
  const set = new Set(added);
  const open = layout.openPorts().filter((p) => set.has(p.piece));
  for (let i = 0; i < open.length; i++) for (let j = 0; j < open.length; j++) {
    if (i === j) continue;
    const A = open[i], B = open[j];
    const d = Math.hypot(A.x - B.x, A.y - B.y);
    if (d > 320 || Math.abs(norm(A.a - B.a + 180)) > 70) continue;
    const r = closeGap(A, B);
    if (r.ok) { layout.addMany(toCurrentSystem(r.pieces)); toast(t('close.auto', { list: listIds(r.pieces) }), 5000); return true; }
  }
  return false;
}

// ---- narzędzia zaznaczenia -------------------------------------------------
$('btn-rot-l').addEventListener('click', () => editor.rotateSelected(-15));
$('btn-rot-r').addEventListener('click', () => editor.rotateSelected(15));
$('btn-del').addEventListener('click', () => editor.deleteSelected());
for (const id of ['in-sel-w', 'in-sel-h']) $(id).addEventListener('change', () => {
  const sc = editor.selectedScenery, p = editor.selected;
  if (sc) layout.resizeScenery(sc, +$('in-sel-w').value || sc.w, +$('in-sel-h').value || sc.h);
  else if (p && BY_ID[p.id].turntable) layout.setTurntableRadius(p, (+$('in-sel-w').value || p.r * 2) / 2);
});
$('in-sel-z').addEventListener('change', () => { const p = editor.selected; if (p) layout.setHeight(p, +$('in-sel-z').value || 0); });
$('in-sel-g').addEventListener('change', () => { const p = editor.selected; if (p) layout.setGrade(p, Math.max(-8, Math.min(8, +$('in-sel-g').value || 0))); });
editor.on((kind) => {
  if (kind !== 'select') return;
  const p = editor.selected, sc = editor.selectedScenery, group = editor.selection.size > 1;
  $('sel-tools').classList.toggle('hidden', (!p && !sc && !group) || editor.mode === 'draw');
  if (group) { $('sel-name').textContent = t('sel.group', { n: editor.selection.size }); for (const id of ['sel-size-w', 'sel-size-h', 'sel-z', 'sel-grade']) $(id).classList.add('hidden'); view3d.setSelected(null); return; }
  const tt = p && BY_ID[p.id].turntable;
  $('sel-size-w').classList.toggle('hidden', !sc && !tt);
  $('sel-size-h').classList.toggle('hidden', !sc || SCENERY[sc.type].resize === 'uniform');
  $('sel-z').classList.toggle('hidden', !p);
  $('sel-grade').classList.toggle('hidden', !p || tt);
  $('sel-size-w').querySelector('span').textContent = t(tt ? 'sel.dia' : 'sel.w');
  if (p) { $('sel-name').textContent = tt ? BY_ID[p.id].code : `${BY_ID[p.id].id} ${BY_ID[p.id].code}`; $('in-sel-z').value = Math.round(p.z || 0); $('in-sel-g').value = (+Layout.grade(p).toFixed(1)); if (tt) $('in-sel-w').value = Math.round(p.r * 2); }
  if (sc) { $('sel-name').textContent = sceneryName(sc.type, getLang()); $('in-sel-w').value = Math.round(sc.w); $('in-sel-h').value = Math.round(sc.h); }
  view3d.setSelected(p ? p.uid : null);
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? layout.redo() : layout.undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); layout.redo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { editor.deleteSelected(); }
  else if (e.key === 'r') editor.rotateSelected(e.shiftKey ? -15 : 15);
  else if (e.key === 'Enter') { if (editor.mode === 'draw') finishDrawing(); }
  else if (e.key === 'Escape' && editor.mode === 'draw') setDrawMode(false);
  else if (e.key === 'd') setDrawMode(editor.mode !== 'draw');
});

// ---- menu ------------------------------------------------------------------
const menu = $('menu');
$('btn-menu').addEventListener('click', () => { refreshMenu(); menu.classList.remove('hidden'); });
menu.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => menu.classList.add('hidden')));

function refreshMenu() {
  renderProblems();
  $('in-name').value = layout.name;
  $('in-w').value = layout.board.w; $('in-h').value = layout.board.h;
  $('in-board-color').value = layout.board.color || '#5f8f4a';
  $('swatches').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.color === (layout.board.color || '#5f8f4a')));
  const bom = $('bom');
  bom.innerHTML = '';
  const rows = layout.bom();
  if (rows.length) bom.insertAdjacentHTML('beforeend', `<span class="head">${t('bom.need')}</span><span class="head"></span><span class="head"></span><span class="head">${t('bom.have')}</span><span class="head">${t('bom.buy')}</span>`);
  let toBuy = 0;
  for (const { id, n, def } of rows) {
    const have = haveOf(id), buy = Math.max(0, n - have); toBuy += buy;
    bom.insertAdjacentHTML('beforeend', `<span class="n">${n} ×</span><span class="id">${id}</span><span>${def.code} — ${pieceName(def)}</span><input class="have" type="number" min="0" step="1" value="${have}" data-id="${id}"><span class="buy${buy ? '' : ' ok'}">${buy ? buy + ' ×' : '✓'}</span>`);
  }
  const total = layout.totalLength();
  bom.insertAdjacentHTML('beforeend', `<div class="total">${t('bom.total', { n: layout.pieces.length, m: (total / 1000).toFixed(2) })}</div>`);
  $('to-buy').textContent = rows.length ? (toBuy ? t('bom.toBuy', { n: toBuy }) : t('bom.complete')) : '';
}
$('in-name').addEventListener('change', (e) => { layout.name = e.target.value; layout.save(); });

// ---- lista zakupów: ile mam ----
const haveMap = (() => { try { return JSON.parse(localStorage.getItem('routelayout.have')) || {}; } catch { return {}; } })();
const haveOf = (id) => Math.max(0, Math.floor(+haveMap[id] || 0));
$('bom').addEventListener('change', (e) => {
  const inp = e.target.closest('input.have'); if (!inp) return;
  haveMap[inp.dataset.id] = Math.max(0, Math.floor(+inp.value || 0));
  try { localStorage.setItem('routelayout.have', JSON.stringify(haveMap)); } catch { /* ignoruj */ }
  refreshMenu();
});
function shoppingList() {
  return layout.bom().map(({ id, n, def }) => { const buy = Math.max(0, n - haveOf(id)); return buy ? `${buy} × ${id} ${def.code} — ${pieceName(def)}` : null; }).filter(Boolean).join('\n');
}
$('btn-copy-list').addEventListener('click', async () => {
  const text = shoppingList() || t('bom.complete');
  try { await navigator.clipboard.writeText(text); toast(t('bom.copied'), 3000); }
  catch { window.prompt(t('menu.copyList'), text); }
});

// ---- druk ----
const printLabels = () => ({ tile: t('print.tile'), scale: t('print.scale') });
$('btn-print-tiles').addEventListener('click', () => { menu.classList.add('hidden'); printLayout(layout, 'tiles', printLabels()); });
$('btn-print-page').addEventListener('click', () => { menu.classList.add('hidden'); printLayout(layout, 'page', printLabels()); });
$('in-board-color').addEventListener('input', (e) => { layout.setBoardColor(e.target.value); refreshMenu(); });
$('swatches').addEventListener('click', (e) => { const b = e.target.closest('button[data-color]'); if (b) { layout.setBoardColor(b.dataset.color); refreshMenu(); } });
$('btn-board').addEventListener('click', () => layout.setBoard(Math.max(200, +$('in-w').value || 2000), Math.max(200, +$('in-h').value || 1000)));
$('btn-clear').addEventListener('click', () => { if (confirm(t('confirm.clear'))) { editor.selected = null; editor.cursor = null; layout.clear(); } });

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(layout.toJSON(), null, 2)], { type: 'application/json' });
  download(blob, `${safeName(layout.name)}.json`);
});
$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { layout.load(JSON.parse(await f.text())); editor.fit(); menu.classList.add('hidden'); }
  catch (err) { alert(t('error.load') + err.message); }
  e.target.value = '';
});
$('btn-png').addEventListener('click', () => {
  editor.canvas.toBlob((b) => b && download(b, `${safeName(layout.name)}.png`), 'image/png');
});

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const safeName = (s) => (s || 'layout').replace(/[^\w\-]+/g, '_');

// ---- język -----------------------------------------------------------------
const selLang = $('sel-lang');
for (const [code, label] of Object.entries(LANGS)) selLang.append(new Option(label, code));
selLang.value = getLang();
selLang.addEventListener('change', () => { setLang(selLang.value); applyLanguage(); });
function applyLanguage() {
  applyDom();
  $('hint').textContent = t(editor.mode === 'draw' ? 'draw.hint' : 'pal.hint');
  fillSystems(); fillEntry(); buildList();
  refreshMenu();
}
applyDom();

// ---- start -----------------------------------------------------------------
layout.onChange((kind) => { if (kind === 'change') layout.save(); });
// demo tylko przy pierwszym uruchomieniu (brak zapisu); pusty zapisany układ zostaje pusty
if (!Layout.loadSaved(layout)) { layout.name = t('default.name'); demo(); layout.save(); }
loadFromHash();
editor.fit();
setMode((() => { try { return localStorage.getItem('routelayout.mode') || (innerWidth >= 900 ? 'split' : '2d'); } catch { return '2d'; } })());
view3d.fit();
runChecks();

/** Pętla startowa: pokazuje, jak działa auto-rysowanie. */
function demo() {
  editor.cursor = null;
  const first = layout.add('55200', { x: 560, y: 80, rot: 0 });
  editor.cursor = { uid: first.uid, idx: 1 };
  for (const id of ['55200', '55200', '55212', '55212', '55212', '55212', '55212', '55212', '55200', '55200', '55200', '55212', '55212', '55212', '55212', '55212', '55212']) editor.addPiece(id, 0);
  layout.undoStack.length = 0;
  editor.selected = null;
  editor.cursor = null;
}
