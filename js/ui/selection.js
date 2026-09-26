// Pasek zaznaczenia (obrót, usuń, rozmiar, wysokość, nachylenie) i skróty klawiszowe.

import { BY_ID } from '../catalog.js';
import { Layout } from '../layout.js';
import { t, getLang } from '../i18n.js';
import { SCENERY, sceneryName } from '../scenery.js';
import { $ } from './app.js';

export function init(app) {
  const { layout, editor, view3d } = app;

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
    else if (e.key === 'Enter') { if (editor.mode === 'draw') app.finishDrawing(); }
    else if (e.key === 'Escape' && editor.mode === 'draw') app.setDrawMode(false);
    else if (e.key === 'd') app.setDrawMode(editor.mode !== 'draw');
  });
}
