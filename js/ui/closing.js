// Domykanie pętli: przycisk przy aktywnym końcu i automatyczne domknięcie po szkicu.

import { BY_ID } from '../catalog.js';
import { norm } from '../layout.js';
import { t } from '../i18n.js';
import { closeGap, pickPartner } from '../closer.js';
import { $, toast } from './app.js';

export function init(app) {
  const { layout, editor } = app;
  const listIds = (pieces) => pieces.map((p) => BY_ID[p.id].code).join(' + ');

  function closeFromCursor() {
    const A = editor.cursorPort();
    if (!A) return;
    const B = pickPartner(layout, A);
    if (!B) { toast(t('close.noPartner'), 5000); return; }
    const r = closeGap(A, B, 4, app.getSystem());
    if (!r.ok) { toast(t('close.fail', { d: r.error.d.toFixed(1), da: r.error.da.toFixed(1) }), 8000); return; }
    layout.addMany(app.toCurrentSystem(r.pieces));
    editor.cursor = null; editor.selected = null; editor.emit('select'); editor.emit('cursor'); editor.draw();
    toast(t('close.ok', { list: listIds(r.pieces), d: r.error.d.toFixed(2) }), 5000);
  }
  $('btn-close').addEventListener('click', closeFromCursor);
  const refresh = () => $('btn-close').classList.toggle('hidden', !editor.cursorPort() || editor.mode === 'draw');
  editor.on((kind) => { if (kind === 'cursor' || kind === 'mode') refresh(); });
  layout.onChange(refresh);

  /** Po szkicu: jeśli dwa otwarte końce nowych elementów są blisko i naprzeciw – domknij. */
  function autoClose(added) {
    const set = new Set(added);
    const open = layout.openPorts().filter((p) => set.has(p.piece));
    for (let i = 0; i < open.length; i++) for (let j = 0; j < open.length; j++) {
      if (i === j) continue;
      const A = open[i], B = open[j];
      if (Math.hypot(A.x - B.x, A.y - B.y) > 320 || Math.abs(norm(A.a - B.a + 180)) > 70) continue;
      const r = closeGap(A, B, 4, app.getSystem());
      if (r.ok) { layout.addMany(app.toCurrentSystem(r.pieces)); toast(t('close.auto', { list: listIds(r.pieces) }), 5000); return true; }
    }
    return false;
  }

  Object.assign(app, { closeFromCursor, autoClose });
  app.expose({ closeFromCursor });
}
