// Paleta: zakładki PIKO / Akcesoria / Sceneria, system torów, lista wierszy
// z miniaturami, sekcja „ostatnio używane”, port wejściowy.

import { CATALOG, BY_ID, sampleSegment, SYSTEMS, DEFAULT_SYSTEM, toSystem } from '../catalog.js';
import { t, pieceName, getLang } from '../i18n.js';
import { SCENERY, SCENERY_GROUPS, sceneryName, drawScenery2D } from '../scenery.js';
import { $, prefs } from './app.js';

const PIKO_SECTIONS = ['straight', 'curve', 'turnout', 'crossing', 'flex'];
const ic = (name) => `<svg class="ic"><use href="#${name}"/></svg>`;
const fmt = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');

/** Miniatura kształtu elementu: segmenty geometrii przeskalowane do 60×34. */
export function pieceIcon(def) {
  const geo = def.geo;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geo.segments.map((seg) => sampleSegment(seg, 12));
  for (const poly of polys) for (const [x, y] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const sc = Math.min(54 / w, 28 / h, 0.25);
  const ox = 30 - ((minX + maxX) / 2) * sc, oy = 17 - ((minY + maxY) / 2) * sc;
  const d = polys.map((poly) => poly.map(([x, y], k) => `${k ? 'L' : 'M'}${(ox + x * sc).toFixed(1)} ${(oy + y * sc).toFixed(1)}`).join(' ')).join(' ');
  return `<svg class="pal-icon" viewBox="0 0 60 34" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** Miniatura obiektu scenerii: rysowana funkcją 2D na małym canvasie. */
function sceneryIcon(type) {
  const def = SCENERY[type];
  const c = document.createElement('canvas'); c.width = 120; c.height = 68; c.className = 'pal-icon';
  const ctx = c.getContext('2d');
  const sc = Math.min(100 / def.w, 52 / def.h);
  ctx.setTransform(sc, 0, 0, sc, 60, 34);
  drawScenery2D(ctx, { type, x: 0, y: 0, rot: 0, w: def.w, h: def.h }, false);
  return c;
}

function pieceMeta(def) {
  if (def.turntable) return '⌀ 320 mm';
  if (def.group === 'curve') return t('meta.arc', { r: fmt(def.r), a: fmt(def.deg) });
  if (def.group === 'turnout' || def.group === 'crossing') {
    const seg = def.geo.segments[0];
    const L = seg.type === 'line' ? Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) : 0;
    const arc = def.geo.segments.find((g) => g.type === 'arc');
    const a = arc ? Math.abs(arc.a1 - arc.a0) : (def.code.startsWith('K') ? +def.code.slice(1) : 15);
    return L ? t('meta.turnout', { L: fmt(L), a: fmt(a) }) : t('meta.arc', { r: fmt(arc.r), a: fmt(a) });
  }
  return t('meta.len', { L: fmt(def.len || 0) });
}

export function init(app) {
  const { editor } = app;
  const selEntry = $('sel-entry'), palList = $('pal-list'), palTabs = $('pal-tabs'), selSystem = $('sel-system');
  let system = (() => { const v = prefs.get('system', DEFAULT_SYSTEM); return SYSTEMS[v] ? v : DEFAULT_SYSTEM; })();
  let palTab = prefs.get('tab', 'piko');
  const recent = prefs.getJSON('recent', []);

  function fillSystems() {
    selSystem.innerHTML = '';
    for (const [key, def] of Object.entries(SYSTEMS)) selSystem.append(new Option(def.name[getLang()] || def.name.en, key));
    selSystem.value = system;
  }
  selSystem.addEventListener('change', () => { system = selSystem.value; prefs.set('system', system); buildList(); });

  function noteRecent(key) {
    const i = recent.indexOf(key); if (i >= 0) recent.splice(i, 1);
    recent.unshift(key); recent.splice(6);
    prefs.setJSON('recent', recent);
    const st = palList.scrollTop; buildList(); palList.scrollTop = st;   // sekcja „ostatnio używane” na bieżąco, bez skoku listy
  }

  function buildList() {
    palList.innerHTML = '';
    palTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === palTab));
    $('entry-row').classList.toggle('hidden', palTab === 'scenery');
    $('system-row').classList.toggle('hidden', palTab !== 'piko');
    const section = (label) => { const h = document.createElement('div'); h.className = 'pal-section'; h.textContent = label; palList.append(h); };
    const recentHere = recent.filter((k) => (palTab === 'scenery' ? !!SCENERY[k] : BY_ID[k] && (palTab === 'accessory' ? BY_ID[k].group === 'accessory' : BY_ID[k].group !== 'accessory'))).map((k) => (BY_ID[k] && palTab === 'piko' ? toSystem(k, system) : k));
    if (recentHere.length) { section(t('pal.recent')); for (const k of [...new Set(recentHere)]) palList.append(SCENERY[k] ? sceneryRow(k) : pieceRow(BY_ID[k])); }
    if (palTab === 'scenery') {
      for (const g of SCENERY_GROUPS) {
        section(t('group.' + g));
        for (const [type, def] of Object.entries(SCENERY)) if (def.group === g) palList.append(sceneryRow(type));
      }
      return;
    }
    const groups = palTab === 'piko' ? PIKO_SECTIONS : ['accessory'];
    for (const g of groups) {
      const items = CATALOG.filter((p) => p.group === g && (palTab !== 'piko' || p.system === system));
      if (!items.length) continue;
      if (palTab === 'piko') section(t('group.' + g));
      for (const def of items) palList.append(pieceRow(def));
    }
  }
  function sceneryRow(type) {
    const def = SCENERY[type];
    const row = document.createElement('div');
    row.className = 'pal-item'; row.dataset.type = type; row.setAttribute('role', 'listitem');
    row.append(sceneryIcon(type));
    row.insertAdjacentHTML('beforeend', `<div class="pal-text"><div class="pal-title">${sceneryName(type, getLang())}</div><div class="pal-desc">${t('meta.size', { w: def.w, h: def.h })}</div></div>`);
    row.addEventListener('click', () => { noteRecent(type); editor.addScenery(type); });
    return row;
  }
  function pieceRow(def) {
    const row = document.createElement('div');
    row.className = 'pal-item'; row.dataset.id = def.id; row.setAttribute('role', 'listitem');
    row.innerHTML = `${pieceIcon(def)}<div class="pal-text"><div class="pal-title">${def.code}<span class="pal-id">${def.id}</span></div><div class="pal-desc">${pieceName(def)}${def.verified === false ? ' ' + t('pal.unverified') : ''}</div></div><div class="pal-meta">${pieceMeta(def)}</div>`;
    const add = (entry) => { noteRecent(def.base || def.id); editor.addPiece(def.id, entry); };
    if (def.group === 'curve') {
      const acts = document.createElement('div'); acts.className = 'pal-actions';
      acts.innerHTML = `<button type="button" data-entry="0" title="${t('pal.left')}">${ic('i-rotate-ccw')}</button><button type="button" data-entry="1" title="${t('pal.rightBtn')}">${ic('i-rotate-cw')}</button>`;
      acts.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); add(+b.dataset.entry); }));
      row.append(acts);
    }
    row.addEventListener('click', () => add(def.group === 'curve' ? 0 : +selEntry.value || 0));
    return row;
  }
  function fillEntry() {
    const cur = selEntry.value || '0';
    selEntry.innerHTML = '';
    for (let i = 0; i < 4; i++) selEntry.append(new Option(i === 0 ? `0: ${t('port.start')}` : `${i}: ${t('port.generic', { i })}`, String(i)));
    selEntry.value = cur;
  }
  palTabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    palTab = b.dataset.tab; prefs.set('tab', palTab);
    buildList();
  });
  fillSystems(); fillEntry(); buildList();

  // zwijanie palety na telefonie
  $('palette-grip').addEventListener('click', () => { $('palette').classList.toggle('collapsed'); setTimeout(() => { editor.resize(); app.view3d.resize(); }, 220); });

  /** Programowe wstawianie (testy, konsola): tor po id z portem wejściowym albo obiekt scenerii po typie. */
  const insert = (idOrType, entry = 0) => (SCENERY[idOrType] ? editor.addScenery(idOrType) : editor.addPiece(idOrType, entry));

  Object.assign(app, {
    buildList, fillEntry, fillSystems, insert,
    /** Mapuje elementy (z dopasowania szkicu, domykania) na wybrany system torów. */
    toCurrentSystem: (pieces) => pieces.map((p) => ({ ...p, id: toSystem(p.id, system) })),
    getSystem: () => system,
    setSystem: (v) => { selSystem.value = v; selSystem.dispatchEvent(new Event('change')); },
  });
  app.expose({ insert, recent, getSystem: app.getSystem, setSystem: app.setSystem });
}
