// Kontekst aplikacji dzielony przez plastry UI: model, widoki, toast, preferencje.
// Każdy plaster (js/ui/*.js) eksportuje init(app) i dopisuje do app funkcje,
// których potrzebują inne plastry (np. app.setDrawMode, app.buildList).

import { Layout } from '../layout.js';
import { Editor2D } from '../editor2d.js';
import { View3D } from '../view3d.js';
import { t } from '../i18n.js';

export const $ = (id) => document.getElementById(id);

/** Preferencje w localStorage (routelayout.*), odporne na tryb prywatny Safari. */
export const prefs = {
  get(key, fallback) { try { const v = localStorage.getItem('routelayout.' + key); return v === null ? fallback : v; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('routelayout.' + key, String(value)); } catch { /* ignoruj */ } },
  getJSON(key, fallback) { try { return JSON.parse(localStorage.getItem('routelayout.' + key)) ?? fallback; } catch { return fallback; } },
  setJSON(key, value) { try { localStorage.setItem('routelayout.' + key, JSON.stringify(value)); } catch { /* ignoruj */ } },
};

let toastTimer = null;
/** Widoczny komunikat zamiast cichej awarii (iPad nie ma konsoli). */
export function toast(msg, ms = 8000) {
  const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
export const errMsg = (e) => (e && (e.message || e.reason?.message || String(e.reason || e))) || 'unknown';

export function createApp() {
  window.addEventListener('error', (e) => toast(t('error.generic', { msg: errMsg(e.error || e) + (e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno}` : '') })));
  window.addEventListener('unhandledrejection', (e) => toast(t('error.generic', { msg: errMsg(e) })));
  window.addEventListener('routelayout:error', (e) => toast(t('error.generic', { msg: errMsg(e.detail) })));

  const layout = new Layout();
  const editor = new Editor2D($('canvas2d'), layout);
  const view3d = new View3D($('view3d'), layout);
  const app = { layout, editor, view3d, toast, errMsg, prefs, $ };
  // hak diagnostyczny (testy, konsola) – plastry dopisują swoje funkcje
  window.__routelayout = { layout, editor, view3d };
  app.expose = (obj) => Object.assign(window.__routelayout, obj);
  return app;
}
