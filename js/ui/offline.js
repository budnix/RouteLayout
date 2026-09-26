// Tryb offline: rejestruje service worker (sw.js), informuje o gotowości i o nowej wersji.

import { t } from '../i18n.js';
import { toast } from './app.js';

export function init(app) {
  if (!('serviceWorker' in navigator)) { app.offline = { supported: false }; return; }
  const state = { supported: true, ready: false, updated: false };
  app.offline = state;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    state.registration = reg;
    return navigator.serviceWorker.ready;
  }).then(() => {
    state.ready = true;
    if (!hadController) toast(t('offline.ready'), 4000);
  }).catch((err) => console.warn('service worker', err));
  // nowy worker przejął stronę: załadowane moduły są stare – zaproponuj przeładowanie
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) { state.updated = true; toast(t('offline.updated'), 10000); } });
  app.expose({ offline: state });
}
