// Tryb szkicu: siatka pomocnicza, normalizacja na żywo, dopasowanie torów po „Zakończ”.

import { t } from '../i18n.js';
import { fitStrokes, normalizeStroke } from '../fitter.js';
import { $, prefs, toast, errMsg } from './app.js';

export function init(app) {
  const { layout, editor } = app;

  // siatka pomocnicza
  const gridPrefs = prefs.getJSON('grid', {});
  const aidGrid = { enabled: !!gridPrefs.enabled, size: +gridPrefs.size || 50 };
  function applyGrid() {
    editor.setAidGrid(aidGrid.enabled, aidGrid.size);
    $('chk-grid').checked = aidGrid.enabled; $('chk-grid-menu').checked = aidGrid.enabled; $('in-grid').value = aidGrid.size;
    prefs.setJSON('grid', aidGrid);
  }
  $('chk-grid').addEventListener('change', (e) => { aidGrid.enabled = e.target.checked; applyGrid(); });
  $('chk-grid-menu').addEventListener('change', (e) => { aidGrid.enabled = e.target.checked; applyGrid(); });
  $('in-grid').addEventListener('change', (e) => { aidGrid.size = Math.min(500, Math.max(5, +e.target.value || 50)); applyGrid(); });
  applyGrid();

  // normalizacja linii – domyślnie włączona
  const fixPref = { on: prefs.get('fix', '1') !== '0' };
  function applyFixPref() { editor.normalizer = fixPref.on ? (pts) => normalizeStroke(pts, layout) : null; $('chk-fix').checked = fixPref.on; }
  $('chk-fix').addEventListener('change', (e) => { fixPref.on = e.target.checked; prefs.set('fix', fixPref.on ? '1' : '0'); applyFixPref(); });
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
    window.__railsketch.lastFit = result;
    const { pieces } = result;
    if (!pieces.length) { toast(t('draw.none'), 5000); return; }
    const added = layout.addMany(app.toCurrentSystem(pieces));
    editor.clearSketch();
    setDrawMode(false);
    app.autoClose?.(added);
    editor.selected = added[added.length - 1];
    const open = layout.openPorts().find((p) => p.piece === editor.selected);
    editor.cursor = open ? { uid: editor.selected.uid, idx: open.idx } : null;
    editor.emit('select'); editor.emit('cursor'); editor.draw();
  }

  Object.assign(app, { setDrawMode, finishDrawing });
}
