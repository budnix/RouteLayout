// Orkiestracja: tworzy kontekst, inicjuje plastry UI (js/ui/*) i uruchamia aplikację.

import { Layout } from './layout.js';
import { t } from './i18n.js';
import { createApp, prefs } from './ui/app.js';
import * as palette from './ui/palette.js';
import * as topbar from './ui/topbar.js';
import * as sketch from './ui/sketch.js';
import * as problems from './ui/problems.js';
import * as tools from './ui/tools.js';
import * as trainmode from './ui/trainmode.js';
import * as closing from './ui/closing.js';
import * as selection from './ui/selection.js';
import * as menu from './ui/menu.js';

const app = createApp();
for (const slice of [palette, topbar, sketch, problems, tools, trainmode, closing, selection, menu]) slice.init(app);

const { layout, editor, view3d } = app;

// ---- start -----------------------------------------------------------------
layout.onChange((kind) => { if (kind === 'change') layout.save(); });
// demo tylko przy pierwszym uruchomieniu (brak zapisu); pusty zapisany układ zostaje pusty
if (!Layout.loadSaved(layout)) { layout.name = t('default.name'); demo(); layout.save(); }
app.loadFromHash();
editor.fit();
app.setMode(prefs.get('mode', innerWidth >= 900 ? 'split' : '2d'));
view3d.fit();
app.runChecks();

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
