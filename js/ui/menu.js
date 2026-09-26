// Menu: nazwa, blat, kolor, siatka, eksport/import, PNG, link, druk, lista problemów,
// zestawienie części z listą zakupów, język.

import { t, pieceName, applyDom, setLang, getLang, LANGS } from '../i18n.js';
import { printLayout, buildPrintView, removePrintView } from '../print.js';
import { encodeShare, decodeShare, shareUrl } from '../share.js';
import { $, prefs, toast, errMsg } from './app.js';

export function init(app) {
  const { layout, editor } = app;
  const menu = $('menu');
  const closeMenu = () => menu.classList.add('hidden');
  $('btn-menu').addEventListener('click', () => { refreshMenu(); menu.classList.remove('hidden'); });
  menu.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeMenu));

  // ---- lista zakupów: ile mam ----
  const haveMap = prefs.getJSON('have', {});
  const haveOf = (id) => Math.max(0, Math.floor(+haveMap[id] || 0));
  $('bom').addEventListener('change', (e) => {
    const inp = e.target.closest('input.have'); if (!inp) return;
    haveMap[inp.dataset.id] = Math.max(0, Math.floor(+inp.value || 0));
    prefs.setJSON('have', haveMap);
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

  function refreshMenu() {
    app.renderProblems?.();
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
  $('in-board-color').addEventListener('input', (e) => { layout.setBoardColor(e.target.value); refreshMenu(); });
  $('swatches').addEventListener('click', (e) => { const b = e.target.closest('button[data-color]'); if (b) { layout.setBoardColor(b.dataset.color); refreshMenu(); } });
  $('btn-board').addEventListener('click', () => layout.setBoard(Math.max(200, +$('in-w').value || 2000), Math.max(200, +$('in-h').value || 1000)));
  $('btn-clear').addEventListener('click', () => { if (confirm(t('confirm.clear'))) { editor.selected = null; editor.cursor = null; layout.clear(); } });

  // ---- pliki ----
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const safeName = (s) => (s || 'layout').replace(/[^\w\-]+/g, '_');
  $('btn-export').addEventListener('click', () => download(new Blob([JSON.stringify(layout.toJSON(), null, 2)], { type: 'application/json' }), `${safeName(layout.name)}.json`));
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { layout.load(JSON.parse(await f.text())); editor.fit(); closeMenu(); }
    catch (err) { alert(t('error.load') + err.message); }
    e.target.value = '';
  });
  $('btn-png').addEventListener('click', () => editor.canvas.toBlob((b) => b && download(b, `${safeName(layout.name)}.png`), 'image/png'));

  // ---- link ----
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

  // ---- druk ----
  const printLabels = () => ({ tile: t('print.tile'), scale: t('print.scale') });
  $('btn-print-tiles').addEventListener('click', () => { closeMenu(); printLayout(layout, 'tiles', printLabels()); });
  $('btn-print-page').addEventListener('click', () => { closeMenu(); printLayout(layout, 'page', printLabels()); });

  // ---- język ----
  const selLang = $('sel-lang');
  for (const [code, label] of Object.entries(LANGS)) selLang.append(new Option(label, code));
  selLang.value = getLang();
  selLang.addEventListener('change', () => { setLang(selLang.value); applyLanguage(); });
  function applyLanguage() {
    applyDom();
    $('hint').textContent = t(editor.mode === 'draw' ? 'draw.hint' : editor.mode === 'train' ? 'train.hint' : 'pal.hint');
    app.fillSystems(); app.fillEntry(); app.buildList();
    refreshMenu();
  }
  applyDom();

  Object.assign(app, { refreshMenu, closeMenu, loadFromHash, shoppingList });
  app.expose({ buildPrintView, removePrintView, shoppingList, encodeShare, decodeShare, loadFromHash });
}
