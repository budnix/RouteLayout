// Poziomy (warstwy) w 2D: filtr wysokości – widoczny i edytowalny jest tylko wybrany poziom,
// pozostałe elementy są wyszarzone. Poziomy wynikają z układu (Layout.levels), nic nie trzeba deklarować.

import { t } from '../i18n.js';
import { $ } from './app.js';

export function init(app) {
  const { layout, editor } = app;
  const bar = $('levels-bar'), sel = $('sel-level');
  let open = false;

  function levelOf(value) {
    if (value === 'all') return null;
    const lv = layout.levels().find((l) => String(l.z) === value);
    return lv ? { min: lv.min, max: lv.max, z: lv.z } : null;
  }
  function fill() {
    const levels = layout.levels();
    const cur = editor.level ? String(editor.level.z) : 'all';
    sel.innerHTML = '';
    sel.append(new Option(t('levels.all', { n: levels.length }), 'all'));
    for (const lv of levels) sel.append(new Option(t('levels.one', { z: lv.z, n: lv.count / 2 }), String(lv.z)));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'all';
    if (sel.value === 'all' && editor.level) editor.setLevel(null);   // poziom zniknął (np. usunięto elementy)
    else if (editor.level) { const lv = levelOf(sel.value); if (lv && (lv.min !== editor.level.min || lv.max !== editor.level.max)) editor.setLevel(lv); }
    $('btn-levels').classList.toggle('active', open || !!editor.level);
    $('levels-count').textContent = levels.length > 1 ? String(levels.length) : '';
  }
  function setLevels(on) {
    open = on;
    bar.classList.toggle('hidden', !on);
    if (!on) editor.setLevel(null);
    fill();
  }
  sel.addEventListener('change', () => { editor.setLevel(levelOf(sel.value)); fill(); });
  $('btn-levels').addEventListener('click', () => setLevels(!open));
  $('btn-level-up').addEventListener('click', () => step(1));
  $('btn-level-down').addEventListener('click', () => step(-1));
  function step(d) {
    const i = sel.selectedIndex + d;
    if (i < 0 || i >= sel.options.length) return;
    sel.selectedIndex = i; editor.setLevel(levelOf(sel.value)); fill();
  }
  layout.onChange((kind) => { if (kind === 'change') fill(); });
  editor.on((kind) => { if (kind === 'mode' && (editor.mode === 'draw' || editor.mode === 'train') && editor.level) { sel.value = 'all'; editor.setLevel(null); fill(); } });
  fill();

  Object.assign(app, { setLevels });
  app.expose({ setLevels, setLevel: (lv) => { editor.setLevel(lv); fill(); } });
}
