// Pasek górny: nowy układ, undo/redo, tryby 2D/3D/split, HUD (dopasuj, zoom), panel boczny.

import { t } from '../i18n.js';
import { $, prefs } from './app.js';

export function init(app) {
  const { layout, editor, view3d } = app;
  const ws = document.querySelector('.workspace');

  function setMode(m) {
    ws.className = `workspace mode-${m}`;
    for (const k of ['2d', '3d', 'split']) $(`tab-${k}`).classList.toggle('active', k === m);
    requestAnimationFrame(() => { editor.resize(); view3d.resize(); if (m !== '2d') view3d.fit(); });
    prefs.set('mode', m);
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

  // chowanie panelu bocznego (szerokie ekrany)
  function setSide(collapsed) {
    document.body.classList.toggle('side-collapsed', collapsed);
    prefs.set('side', collapsed ? '1' : '0');
    requestAnimationFrame(() => { editor.resize(); view3d.resize(); });
  }
  $('btn-side').addEventListener('click', () => setSide(!document.body.classList.contains('side-collapsed')));
  if (prefs.get('side', '0') === '1') setSide(true);

  app.setMode = setMode;
}
