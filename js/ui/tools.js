// Narzędzia planu: zaznaczanie prostokątem, tryb wymiarów.

import { $, prefs } from './app.js';

export function init(app) {
  const { editor } = app;

  $('btn-marquee').addEventListener('click', () => {
    if (editor.mode === 'draw') app.setDrawMode(false);
    if (editor.mode === 'train') app.setTrainMode(false);
    editor.setMode(editor.mode === 'marquee' ? 'edit' : 'marquee');
  });
  editor.on((kind) => { if (kind === 'mode') $('btn-marquee').classList.toggle('active', editor.mode === 'marquee'); });

  function setDims(on) { editor.dims = on; $('btn-dims').classList.toggle('active', on); prefs.set('dims', on ? '1' : '0'); editor.draw(); }
  $('btn-dims').addEventListener('click', () => setDims(!editor.dims));
  setDims(prefs.get('dims', '0') === '1');

  app.setDims = setDims;
}
