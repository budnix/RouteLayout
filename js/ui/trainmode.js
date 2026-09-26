// Jazda próbna: pociąg na torach, start/stop, prędkość, nawrót, przełączanie rozjazdów stuknięciem.

import { t } from '../i18n.js';
import { Train, toggleSwitch } from '../train.js';
import { $, toast } from './app.js';

export function init(app) {
  const { layout, editor, view3d } = app;
  const train = new Train(layout);
  editor.train = train;
  let raf = null, last = 0;

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;
    if (train.running) train.step(dt);
    editor.draw();
    view3d.setTrain(train.pose(), train.carPoses());
    if (!train.running) { cancelAnimationFrame(raf); raf = null; updatePlayIcon(); }
  }
  function updatePlayIcon() { $('btn-play').innerHTML = `<svg class="ic"><use href="#${train.running ? 'i-pause' : 'i-play'}"/></svg>`; }
  function updateSpeedLabel() { const v = train.speed; $('speed-label').textContent = t('train.speed', { v, kmh: Math.round(v * 87 * 3.6 / 1000) }); }

  function setTrainMode(on) {
    if (on && !layout.pieces.length) { toast(t('train.none'), 4000); return; }
    if (on) {
      if (editor.mode === 'draw') app.setDrawMode(false);
      const cur = editor.cursorPort();
      const start = cur ? [cur.piece, cur.idx] : [layout.pieces[0], 0];
      if (!train.pos || !layout.pieces.includes(train.pos.piece)) train.place(start[0], start[1]);
      editor.selected = null; editor.selectedScenery = null; editor.emit('select');
    } else { train.running = false; if (raf) { cancelAnimationFrame(raf); raf = null; } view3d.setTrain(null); }
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
      train.running = true; last = performance.now(); if (!raf) raf = requestAnimationFrame(frame);
    }
    updatePlayIcon();
  });
  $('btn-reverse').addEventListener('click', () => { train.reverse(); editor.draw(); view3d.setTrain(train.pose(), train.carPoses()); });
  $('in-speed').addEventListener('input', (e) => { train.speed = +e.target.value; updateSpeedLabel(); });
  editor.on((kind, _ed, piece) => { if (kind !== 'switch' || !piece) return; if (toggleSwitch(piece) !== null) { layout.save(); editor.draw(); } });
  layout.onChange((kind) => { if (kind === 'change' && editor.mode === 'train' && train.pos && !layout.pieces.includes(train.pos.piece)) { train.pos = null; if (layout.pieces.length) train.place(layout.pieces[0], 0); } });

  app.setTrainMode = setTrainMode;
  app.expose({ train, setTrainMode });
}
