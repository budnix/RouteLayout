import { CATALOG, GROUPS, QUICK, BY_ID } from './catalog.js';
import { Layout } from './layout.js';
import { Editor2D } from './editor2d.js';
import { View3D } from './view3d.js';
import { t, pieceName, applyDom, setLang, getLang, LANGS } from './i18n.js';
import { fitStrokes } from './fitter.js';
import { SCENERY, SCENERY_GROUPS, sceneryName } from './scenery.js';

const $ = (id) => document.getElementById(id);

const layout = new Layout();
const editor = new Editor2D($('canvas2d'), layout);
const view3d = new View3D($('view3d'), layout);

// ---- paleta ----------------------------------------------------------------
const selGroup = $('sel-group'), selPiece = $('sel-piece'), selEntry = $('sel-entry');
function fillGroups() {
  const cur = selGroup.value || 'straight';
  selGroup.innerHTML = '';
  for (const g of GROUPS) selGroup.append(new Option(t('group.' + g), g));
  for (const g of SCENERY_GROUPS) selGroup.append(new Option(t('group.' + g), g));
  selGroup.value = cur;
}
fillGroups();

const isSceneryGroup = () => SCENERY_GROUPS.includes(selGroup.value);
function fillPieces() {
  selPiece.innerHTML = '';
  if (isSceneryGroup()) {
    for (const [type, def] of Object.entries(SCENERY)) if (def.group === selGroup.value) selPiece.append(new Option(sceneryName(type, getLang()), type));
    selEntry.parentElement.classList.add('hidden');
    return;
  }
  selEntry.parentElement.classList.remove('hidden');
  for (const p of CATALOG.filter((p) => p.group === selGroup.value)) {
    selPiece.append(new Option(`${p.id} · ${p.code} — ${pieceName(p)}${p.verified === false ? ' ' + t('pal.unverified') : ''}`, p.id));
  }
  fillEntry();
}
const PORT_LABEL = { turnout: ['port.toe', 'port.straight', 'port.branch', 'port.branch2'], crossing: ['A1', 'A2', 'B1', 'B2'], turntable: ['port.bridgeA', 'port.bridgeB'] };
function fillEntry() {
  if (isSceneryGroup()) return;
  const def = BY_ID[selPiece.value];
  selEntry.innerHTML = '';
  def.geo.ports.forEach((_, i) => {
    const key = (PORT_LABEL[def.turntable ? 'turntable' : def.group] || ['port.start', 'port.end'])[i];
    const lbl = key ? (key.startsWith('port.') ? t(key) : key) : t('port.n', { i });
    selEntry.append(new Option(`${i}: ${lbl}`, String(i)));
  });
}
selGroup.addEventListener('change', fillPieces);
selPiece.addEventListener('change', fillEntry);
fillPieces();

function insertSelected() { if (isSceneryGroup()) editor.addScenery(selPiece.value); else editor.addPiece(selPiece.value, +selEntry.value); }
$('btn-add').addEventListener('click', insertSelected);

const quick = $('quick');
for (const id of QUICK) {
  const p = BY_ID[id];
  const b = document.createElement('button');
  b.innerHTML = `${p.code}<b>${p.id}</b>`;
  b.title = pieceName(p);
  b.addEventListener('click', () => editor.addPiece(id, 0));
  quick.append(b);
}
// łuk w drugą stronę: ten sam artykuł, wejście portem 1
const bR = document.createElement('button');
bR.innerHTML = `R2 <svg class="ic sm"><use href="#i-rotate-cw"/></svg><b>${t('pal.right')}</b>`; bR.title = t('pal.rightTitle');
bR.addEventListener('click', () => editor.addPiece('55212', 1));
quick.append(bR);

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
  const { pieces } = fitStrokes(editor.strokes, layout);
  if (!pieces.length) { alert(t('draw.none')); return; }
  const added = layout.addMany(pieces);
  editor.clearSketch();
  setDrawMode(false);
  editor.selected = added[added.length - 1];
  const open = layout.openPorts().find((p) => p.piece === editor.selected);
  editor.cursor = open ? { uid: editor.selected.uid, idx: open.idx } : null;
  editor.emit('select'); editor.emit('cursor'); editor.draw();
}
editor.on((kind) => { if (kind === 'sketch') $('btn-finish').disabled = !editor.strokes.length; });
$('btn-finish').disabled = true;

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
  const p = editor.selected, sc = editor.selectedScenery;
  $('sel-tools').classList.toggle('hidden', (!p && !sc) || editor.mode === 'draw');
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
  else if (e.key === 'Enter') { if (editor.mode === 'draw') finishDrawing(); else insertSelected(); }
  else if (e.key === 'Escape' && editor.mode === 'draw') setDrawMode(false);
  else if (e.key === 'd') setDrawMode(editor.mode !== 'draw');
});

// ---- menu ------------------------------------------------------------------
const menu = $('menu');
$('btn-menu').addEventListener('click', () => { refreshMenu(); menu.classList.remove('hidden'); });
menu.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => menu.classList.add('hidden')));

function refreshMenu() {
  $('in-name').value = layout.name;
  $('in-w').value = layout.board.w; $('in-h').value = layout.board.h;
  const bom = $('bom');
  bom.innerHTML = '';
  for (const { id, n, def } of layout.bom()) {
    bom.insertAdjacentHTML('beforeend', `<span class="n">${n} ×</span><span class="id">${id}</span><span>${def.code} — ${pieceName(def)}</span>`);
  }
  const total = layout.totalLength();
  bom.insertAdjacentHTML('beforeend', `<div class="total">${t('bom.total', { n: layout.pieces.length, m: (total / 1000).toFixed(2) })}</div>`);
}
$('in-name').addEventListener('change', (e) => { layout.name = e.target.value; layout.save(); });
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
  fillGroups(); fillPieces();
  bR.innerHTML = `R2 <svg class="ic sm"><use href="#i-rotate-cw"/></svg><b>${t('pal.right')}</b>`; bR.title = t('pal.rightTitle');
  quick.querySelectorAll('button').forEach((b, i) => { if (QUICK[i]) b.title = pieceName(BY_ID[QUICK[i]]); });
  refreshMenu();
}
applyDom();

// hak diagnostyczny (testy, konsola)
window.__routelayout = { layout, editor, view3d };

// ---- start -----------------------------------------------------------------
layout.onChange((kind) => { if (kind === 'change') layout.save(); });
// demo tylko przy pierwszym uruchomieniu (brak zapisu); pusty zapisany układ zostaje pusty
if (!Layout.loadSaved(layout)) { layout.name = t('default.name'); demo(); layout.save(); }
editor.fit();
setMode((() => { try { return localStorage.getItem('routelayout.mode') || (innerWidth >= 900 ? 'split' : '2d'); } catch { return '2d'; } })());
view3d.fit();

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
