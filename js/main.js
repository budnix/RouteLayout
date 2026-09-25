import { CATALOG, GROUPS, QUICK, BY_ID } from './catalog.js';
import { Layout } from './layout.js';
import { Editor2D } from './editor2d.js';
import { View3D } from './view3d.js';

const $ = (id) => document.getElementById(id);

const layout = new Layout();
const editor = new Editor2D($('canvas2d'), layout);
const view3d = new View3D($('view3d'), layout);

// ---- paleta ----------------------------------------------------------------
const selGroup = $('sel-group'), selPiece = $('sel-piece'), selEntry = $('sel-entry');
for (const g of GROUPS) selGroup.append(new Option(g.label, g.key));
selGroup.value = 'straight';

function fillPieces() {
  selPiece.innerHTML = '';
  for (const p of CATALOG.filter((p) => p.group === selGroup.value)) {
    selPiece.append(new Option(`${p.id} · ${p.code} — ${p.name}${p.verified === false ? ' (nr do potwierdzenia)' : ''}`, p.id));
  }
  fillEntry();
}
const PORT_LABEL = { turnout: ['początek (ostrze)', 'prosto', 'odgałęzienie', 'odgałęzienie 2'], crossing: ['A1', 'A2', 'B1', 'B2'] };
function fillEntry() {
  const def = BY_ID[selPiece.value];
  selEntry.innerHTML = '';
  def.geo.ports.forEach((_, i) => {
    const lbl = (PORT_LABEL[def.group] || ['początek', 'koniec'])[i] || `port ${i}`;
    selEntry.append(new Option(`${i}: ${lbl}`, String(i)));
  });
}
selGroup.addEventListener('change', fillPieces);
selPiece.addEventListener('change', fillEntry);
fillPieces();

$('btn-add').addEventListener('click', () => editor.addPiece(selPiece.value, +selEntry.value));

const quick = $('quick');
for (const id of QUICK) {
  const p = BY_ID[id];
  const b = document.createElement('button');
  b.innerHTML = `${p.code}<b>${p.id}</b>`;
  b.title = p.name;
  b.addEventListener('click', () => editor.addPiece(id, 0));
  quick.append(b);
}
// łuk w drugą stronę: ten sam artykuł, wejście portem 1
const bR = document.createElement('button');
bR.innerHTML = 'R2 ↷<b>w prawo</b>'; bR.title = 'Łuk R2 skręcający w prawo (wejście portem 1)';
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
$('btn-undo').addEventListener('click', () => layout.undo());
$('btn-redo').addEventListener('click', () => layout.redo());

$('btn-fit2d').addEventListener('click', () => editor.fit());
$('btn-zoom-in').addEventListener('click', () => editor.zoomAt(editor.canvas.clientWidth / 2, editor.canvas.clientHeight / 2, 1.25));
$('btn-zoom-out').addEventListener('click', () => editor.zoomAt(editor.canvas.clientWidth / 2, editor.canvas.clientHeight / 2, 0.8));
$('btn-fit3d').addEventListener('click', () => view3d.fit());

// ---- narzędzia zaznaczenia -------------------------------------------------
$('btn-rot-l').addEventListener('click', () => editor.rotateSelected(-15));
$('btn-rot-r').addEventListener('click', () => editor.rotateSelected(15));
$('btn-del').addEventListener('click', () => editor.deleteSelected());
editor.on((kind) => {
  if (kind !== 'select') return;
  const p = editor.selected;
  $('sel-tools').classList.toggle('hidden', !p);
  if (p) $('sel-name').textContent = `${BY_ID[p.id].id} ${BY_ID[p.id].code}`;
  view3d.setSelected(p ? p.uid : null);
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? layout.redo() : layout.undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); layout.redo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { editor.deleteSelected(); }
  else if (e.key === 'r') editor.rotateSelected(e.shiftKey ? -15 : 15);
  else if (e.key === 'Enter') editor.addPiece(selPiece.value, +selEntry.value);
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
    bom.insertAdjacentHTML('beforeend', `<span class="n">${n} ×</span><span class="id">${id}</span><span>${def.code} — ${def.name}</span>`);
  }
  const total = layout.totalLength();
  bom.insertAdjacentHTML('beforeend', `<div class="total">${layout.pieces.length} elementów, łącznie ${(total / 1000).toFixed(2)} m toru</div>`);
}
$('in-name').addEventListener('change', (e) => { layout.name = e.target.value; layout.save(); });
$('btn-board').addEventListener('click', () => layout.setBoard(Math.max(200, +$('in-w').value || 2000), Math.max(200, +$('in-h').value || 1000)));
$('btn-clear').addEventListener('click', () => { if (confirm('Usunąć wszystkie elementy?')) { editor.selected = null; editor.cursor = null; layout.clear(); } });

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(layout.toJSON(), null, 2)], { type: 'application/json' });
  download(blob, `${safeName(layout.name)}.json`);
});
$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { layout.load(JSON.parse(await f.text())); editor.fit(); menu.classList.add('hidden'); }
  catch (err) { alert('Nie udało się wczytać: ' + err.message); }
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
const safeName = (s) => (s || 'makieta').replace(/[^\w\-]+/g, '_');

// ---- start -----------------------------------------------------------------
layout.onChange((kind) => { if (kind === 'change') layout.save(); });
Layout.loadSaved(layout);
if (!layout.pieces.length) demo();
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
