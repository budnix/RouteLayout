// Kontekst aplikacji dzielony przez plastry UI: model, widoki, toast, preferencje.
// Każdy plaster (js/ui/*.js) eksportuje init(app) i dopisuje do app funkcje,
// których potrzebują inne plastry (np. app.setDrawMode, app.buildList).

import { Layout } from '../layout.js';
import { Editor2D } from '../editor2d.js';
import { View3D } from '../view3d.js';
import { t } from '../i18n.js';

export const $ = (id) => document.getElementById(id);

/** Preferencje w localStorage (railsketch.*), odporne na tryb prywatny Safari. */
export const prefs = {
  get(key, fallback) { try { const v = localStorage.getItem('railsketch.' + key); return v === null ? fallback : v; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('railsketch.' + key, String(value)); } catch { /* ignoruj */ } },
  getJSON(key, fallback) { try { return JSON.parse(localStorage.getItem('railsketch.' + key)) ?? fallback; } catch { return fallback; } },
  setJSON(key, value) { try { localStorage.setItem('railsketch.' + key, JSON.stringify(value)); } catch { /* ignoruj */ } },
};

let toastTimer = null;
/** Widoczny komunikat zamiast cichej awarii (iPad nie ma konsoli). */
export function toast(msg, ms = 8000) {
  const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
export const errMsg = (e) => (e && (e.message || e.reason?.message || String(e.reason || e))) || 'unknown';

/** Jednorazowa migracja zapisu ze starej nazwy aplikacji (RouteLayout → RailSketch): kopiuje klucze, nie kasuje starych. */
export function migrateStorage(storage = localStorage) {
  let n = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !k.startsWith('routelayout.')) continue;
      const nk = 'railsketch.' + k.slice('routelayout.'.length);
      if (storage.getItem(nk) === null) { storage.setItem(nk, storage.getItem(k)); n++; }
    }
  } catch { /* prywatne okno / brak dostępu */ }
  return n;
}

export function createApp() {
  migrateStorage();
  window.addEventListener('error', (e) => toast(t('error.generic', { msg: errMsg(e.error || e) + (e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno}` : '') })));
  window.addEventListener('unhandledrejection', (e) => toast(t('error.generic', { msg: errMsg(e) })));
  window.addEventListener('railsketch:error', (e) => toast(t('error.generic', { msg: errMsg(e.detail) })));

  const layout = new Layout();
  const editor = new Editor2D($('canvas2d'), layout);
  const view3d = new View3D($('view3d'), layout);
  const app = { layout, editor, view3d, toast, errMsg, prefs, $ };
  // hak diagnostyczny (testy, konsola) – plastry dopisują swoje funkcje
  window.__railsketch = { layout, editor, view3d };
  app.expose = (obj) => Object.assign(window.__railsketch, obj);
  return app;
}
