// Kontrola wykonalności: uruchamiana po zmianach, znaczniki na planie, lista w menu, badge.

import { t } from '../i18n.js';
import { checkLayout } from '../checks.js';
import { $ } from './app.js';

export function init(app) {
  const { layout, editor } = app;
  let problems = [];
  let timer = null;

  function runChecks() {
    try { problems = checkLayout(layout); } catch (err) { console.error('checks', err); problems = []; }
    editor.problems = problems;
    const badge = $('menu-badge');
    badge.textContent = String(problems.length);
    badge.classList.toggle('hidden', problems.length === 0);
    editor.draw();
  }
  layout.onChange((kind) => { if (kind !== 'change') return; clearTimeout(timer); timer = setTimeout(runChecks, 120); });

  function renderProblems() {
    const box = $('problems'); box.innerHTML = '';
    const cnt = $('problems-count'); cnt.textContent = problems.length ? String(problems.length) : '✓'; cnt.classList.toggle('ok', !problems.length);
    if (!problems.length) { box.innerHTML = `<div class="none">${t('prob.none')}</div>`; return; }
    for (const pr of problems) {
      const row = document.createElement('div');
      row.className = 'prob' + (pr.type === 'edge' || pr.type === 'grade' ? ' warn' : '');
      row.innerHTML = `<span class="dot"></span><span>${t('prob.' + pr.type, pr.params)}</span>`;
      row.addEventListener('click', () => { app.closeMenu?.(); editor.selected = pr.pieces[0]; editor.selectedScenery = null; editor.emit('select'); centerOn(pr.x, pr.y); });
      box.append(row);
    }
  }
  function centerOn(x, y) {
    const W = editor.canvas.clientWidth, H = editor.canvas.clientHeight;
    editor.view.scale = Math.max(editor.view.scale, 0.6);
    editor.view.ox = W / 2 - x * editor.view.scale; editor.view.oy = H / 2 - y * editor.view.scale;
    editor.draw();
  }

  Object.assign(app, { runChecks, renderProblems, centerOn });
  app.expose({ problems: () => problems });
}
