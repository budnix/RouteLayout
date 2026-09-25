// Prosty i18n: słowniki PL / EN / DE, wybór języka z localStorage lub przeglądarki.

export const LANGS = { pl: 'Polski', en: 'English', de: 'Deutsch' };
const STORAGE_KEY = 'routelayout.lang';

const DICT = {
  pl: {
    'app.title': 'RouteLayout – makiety H0 (PIKO A-Gleis)',
    'app.description': 'Planer układów torów H0 na torach PIKO A-Gleis z podglądem 3D. Działa na iPadzie i iPhonie.',
    'draw.toggle': 'Tryb rysowania: szkicuj tor palcem lub myszą', 'draw.grid': 'Siatka pomocnicza', 'draw.undoStroke': 'Cofnij ostatnią kreskę',
    'draw.clear': 'Wyczyść szkic', 'draw.finish': 'Zakończ rysowanie', 'draw.hint': 'Rysuj przebieg toru. Odgałęzienie: zacznij nową kreskę na już narysowanej. Kreska zaczynająca się przy otwartym końcu toru doczepi się do niego.',
    'draw.none': 'Nie udało się dopasować torów do szkicu. Rysuj dłuższe, płynne kreski.', 'draw.result': 'Wstawiono {n} elementów.', 'menu.gridSize': 'Siatka [mm]',
    'group.trees': 'Sceneria: drzewa', 'group.buildings': 'Sceneria: budynki', 'group.infra': 'Sceneria: infrastruktura', 'group.terrain': 'Sceneria: teren',
    'pal.scenery': 'Obiekt', 'sel.w': 'dł.', 'sel.h': 'szer.',
    'sel.z': 'wys.', 'sel.grade': '%', 'sel.dia': '⌀', 'port.bridgeA': 'most A', 'port.bridgeB': 'most B',
    'side.toggle': 'Pokaż / ukryj panel',
    'draw.fix': 'Normalizuj linie', 'draw.fixTitle': 'Włączone: proste są prostowane, a kąty i promienie dopasowywane do elementów PIKO (np. 7° → 7,5°). Wyłączone: tor podąża za kreską dosłownie.',
    'menu.boardColor': 'Kolor makiety', 'color.grass': 'Trawa', 'color.plywood': 'Sklejka', 'color.grey': 'Szary', 'color.white': 'Biały', 'color.earth': 'Ziemia',
    'top.new': 'Nowy układ', 'confirm.new': 'Zacząć od zera? Bieżący układ zostanie usunięty (możesz go wcześniej wyeksportować do JSON).',
    'top.undo': 'Cofnij (Ctrl+Z)', 'top.redo': 'Ponów (Ctrl+Y)', 'top.menu': 'Menu',
    'hud.fit': 'Dopasuj widok', 'hud.fit3d': 'Dopasuj kamerę',
    'sel.rotl': 'Obróć −15°', 'sel.rotr': 'Obróć +15°', 'sel.del': 'Usuń',
    'pal.group': 'Grupa', 'pal.piece': 'Element PIKO', 'pal.entry': 'Wejście portem', 'pal.add': 'Wstaw',
    'pal.hint': 'Wybierz element i naciśnij „Wstaw”. Pomarańczowa kropka to aktywny koniec toru – kolejny element doklei się tam automatycznie. Stuknij niebieską kropkę, aby zmienić aktywny koniec.',
    'pal.right': 'w prawo', 'pal.rightTitle': 'Łuk R2 skręcający w prawo (wejście portem 1)',
    'pal.unverified': '(nr do potwierdzenia)',
    'menu.layout': 'Makieta', 'menu.name': 'Nazwa', 'menu.lang': 'Język',
    'menu.boardW': 'Blat szer. [mm]', 'menu.boardH': 'Blat gł. [mm]', 'menu.apply': 'Zastosuj',
    'menu.export': 'Eksport JSON', 'menu.import': 'Import JSON', 'menu.png': 'Zapisz PNG (2D)', 'menu.clear': 'Wyczyść',
    'menu.bom': 'Zestawienie części',
    'menu.bomHint': 'Numery katalogowe PIKO A-Gleis (seria 552xx). Geometria: moduł 470 mm, rozstaw torów równoległych 61,88 mm.',
    'menu.close': 'Zamknij',
    'bom.total': '{n} elementów, łącznie {m} m toru',
    'confirm.clear': 'Usunąć wszystkie elementy?', 'error.load': 'Nie udało się wczytać: ',
    'default.name': 'Makieta',
    'port.start': 'początek', 'port.end': 'koniec', 'port.toe': 'początek (ostrze)', 'port.straight': 'prosto',
    'port.branch': 'odgałęzienie', 'port.branch2': 'odgałęzienie 2', 'port.n': 'port {i}',
    'group.straight': 'Proste', 'group.curve': 'Łuki', 'group.turnout': 'Rozjazdy', 'group.crossing': 'Krzyżownice / DKW',
    'group.flex': 'Flex', 'group.accessory': 'Akcesoria',
  },
  en: {
    'app.title': 'RouteLayout – H0 track planner (PIKO A-Gleis)',
    'app.description': 'H0 model railway track planner for PIKO A-Gleis with 3D preview. Works on iPad and iPhone.',
    'draw.toggle': 'Draw mode: sketch track with finger or mouse', 'draw.grid': 'Guide grid', 'draw.undoStroke': 'Undo last stroke',
    'draw.clear': 'Clear sketch', 'draw.finish': 'Finish drawing', 'draw.hint': 'Sketch the track path. For a branch, start a new stroke on an existing one. A stroke starting at an open track end attaches to it.',
    'draw.none': 'Could not fit any track to the sketch. Draw longer, smoother strokes.', 'draw.result': 'Inserted {n} pieces.', 'menu.gridSize': 'Grid [mm]',
    'group.trees': 'Scenery: trees', 'group.buildings': 'Scenery: buildings', 'group.infra': 'Scenery: infrastructure', 'group.terrain': 'Scenery: terrain',
    'pal.scenery': 'Object', 'sel.w': 'L', 'sel.h': 'W',
    'sel.z': 'ht', 'sel.grade': '%', 'sel.dia': '⌀', 'port.bridgeA': 'bridge A', 'port.bridgeB': 'bridge B',
    'side.toggle': 'Show / hide panel',
    'draw.fix': 'Normalise lines', 'draw.fixTitle': 'On: straights are straightened and angles/radii snapped to PIKO pieces (e.g. 7° → 7.5°). Off: the track follows the stroke literally.',
    'menu.boardColor': 'Baseboard colour', 'color.grass': 'Grass', 'color.plywood': 'Plywood', 'color.grey': 'Grey', 'color.white': 'White', 'color.earth': 'Earth',
    'top.new': 'New layout', 'confirm.new': 'Start from scratch? The current layout will be deleted (you can export it to JSON first).',
    'top.undo': 'Undo (Ctrl+Z)', 'top.redo': 'Redo (Ctrl+Y)', 'top.menu': 'Menu',
    'hud.fit': 'Fit view', 'hud.fit3d': 'Fit camera',
    'sel.rotl': 'Rotate −15°', 'sel.rotr': 'Rotate +15°', 'sel.del': 'Delete',
    'pal.group': 'Group', 'pal.piece': 'PIKO piece', 'pal.entry': 'Entry port', 'pal.add': 'Insert',
    'pal.hint': 'Pick a piece and press “Insert”. The orange dot is the active track end – the next piece attaches there automatically. Tap a blue dot to change the active end.',
    'pal.right': 'to the right', 'pal.rightTitle': 'R2 curve turning right (entry via port 1)',
    'pal.unverified': '(article no. to be confirmed)',
    'menu.layout': 'Layout', 'menu.name': 'Name', 'menu.lang': 'Language',
    'menu.boardW': 'Board width [mm]', 'menu.boardH': 'Board depth [mm]', 'menu.apply': 'Apply',
    'menu.export': 'Export JSON', 'menu.import': 'Import JSON', 'menu.png': 'Save PNG (2D)', 'menu.clear': 'Clear',
    'menu.bom': 'Bill of materials',
    'menu.bomHint': 'PIKO A-Gleis article numbers (552xx series). Geometry: 470 mm module, 61.88 mm parallel track spacing.',
    'menu.close': 'Close',
    'bom.total': '{n} pieces, {m} m of track in total',
    'confirm.clear': 'Remove all pieces?', 'error.load': 'Could not load: ',
    'default.name': 'Layout',
    'port.start': 'start', 'port.end': 'end', 'port.toe': 'toe (start)', 'port.straight': 'straight',
    'port.branch': 'branch', 'port.branch2': 'branch 2', 'port.n': 'port {i}',
    'group.straight': 'Straights', 'group.curve': 'Curves', 'group.turnout': 'Turnouts', 'group.crossing': 'Crossings / slips',
    'group.flex': 'Flex', 'group.accessory': 'Accessories',
  },
  de: {
    'app.title': 'RouteLayout – H0-Gleisplaner (PIKO A-Gleis)',
    'app.description': 'Gleisplaner für Modellbahn H0 mit PIKO A-Gleis und 3D-Vorschau. Läuft auf iPad und iPhone.',
    'draw.toggle': 'Zeichenmodus: Gleisverlauf mit Finger oder Maus skizzieren', 'draw.grid': 'Hilfsraster', 'draw.undoStroke': 'Letzten Strich zurücknehmen',
    'draw.clear': 'Skizze löschen', 'draw.finish': 'Zeichnen beenden', 'draw.hint': 'Gleisverlauf skizzieren. Abzweig: neuen Strich auf einem vorhandenen beginnen. Ein Strich, der an einem offenen Gleisende beginnt, wird dort angesetzt.',
    'draw.none': 'Es konnten keine Gleise an die Skizze angepasst werden. Längere, gleichmäßige Striche zeichnen.', 'draw.result': '{n} Gleisstücke eingefügt.', 'menu.gridSize': 'Raster [mm]',
    'group.trees': 'Landschaft: Bäume', 'group.buildings': 'Landschaft: Gebäude', 'group.infra': 'Landschaft: Infrastruktur', 'group.terrain': 'Landschaft: Gelände',
    'pal.scenery': 'Objekt', 'sel.w': 'L', 'sel.h': 'B',
    'sel.z': 'Höhe', 'sel.grade': '%', 'sel.dia': '⌀', 'port.bridgeA': 'Bühne A', 'port.bridgeB': 'Bühne B',
    'side.toggle': 'Panel ein-/ausblenden',
    'draw.fix': 'Linien normalisieren', 'draw.fixTitle': 'Ein: Geraden werden begradigt, Winkel und Radien auf PIKO-Gleise gerundet (z. B. 7° → 7,5°). Aus: das Gleis folgt dem Strich wörtlich.',
    'menu.boardColor': 'Farbe der Anlage', 'color.grass': 'Gras', 'color.plywood': 'Sperrholz', 'color.grey': 'Grau', 'color.white': 'Weiß', 'color.earth': 'Erde',
    'top.new': 'Neue Anlage', 'confirm.new': 'Von vorn beginnen? Die aktuelle Anlage wird gelöscht (vorher als JSON exportierbar).',
    'top.undo': 'Rückgängig (Strg+Z)', 'top.redo': 'Wiederholen (Strg+Y)', 'top.menu': 'Menü',
    'hud.fit': 'Ansicht anpassen', 'hud.fit3d': 'Kamera anpassen',
    'sel.rotl': 'Drehen −15°', 'sel.rotr': 'Drehen +15°', 'sel.del': 'Löschen',
    'pal.group': 'Gruppe', 'pal.piece': 'PIKO-Gleisstück', 'pal.entry': 'Eingang über Anschluss', 'pal.add': 'Einfügen',
    'pal.hint': 'Gleisstück wählen und „Einfügen“ drücken. Der orange Punkt ist das aktive Gleisende – das nächste Stück wird dort automatisch angesetzt. Blauen Punkt antippen, um das aktive Ende zu wechseln.',
    'pal.right': 'nach rechts', 'pal.rightTitle': 'Bogen R2 nach rechts (Eingang über Anschluss 1)',
    'pal.unverified': '(Art.-Nr. zu bestätigen)',
    'menu.layout': 'Anlage', 'menu.name': 'Name', 'menu.lang': 'Sprache',
    'menu.boardW': 'Platte Breite [mm]', 'menu.boardH': 'Platte Tiefe [mm]', 'menu.apply': 'Übernehmen',
    'menu.export': 'JSON exportieren', 'menu.import': 'JSON importieren', 'menu.png': 'PNG speichern (2D)', 'menu.clear': 'Leeren',
    'menu.bom': 'Stückliste',
    'menu.bomHint': 'PIKO A-Gleis Artikelnummern (Serie 552xx). Geometrie: Modul 470 mm, Parallelgleisabstand 61,88 mm.',
    'menu.close': 'Schließen',
    'bom.total': '{n} Gleisstücke, insgesamt {m} m Gleis',
    'confirm.clear': 'Alle Gleisstücke entfernen?', 'error.load': 'Laden fehlgeschlagen: ',
    'default.name': 'Anlage',
    'port.start': 'Anfang', 'port.end': 'Ende', 'port.toe': 'Anfang (Weichenzunge)', 'port.straight': 'gerade',
    'port.branch': 'Abzweig', 'port.branch2': 'Abzweig 2', 'port.n': 'Anschluss {i}',
    'group.straight': 'Gerade Gleise', 'group.curve': 'Bögen', 'group.turnout': 'Weichen', 'group.crossing': 'Kreuzungen / DKW',
    'group.flex': 'Flexgleis', 'group.accessory': 'Zubehör',
  },
};

let lang = detect();

function detect() {
  try { const s = localStorage.getItem(STORAGE_KEY); if (s && DICT[s]) return s; } catch { /* ignoruj */ }
  const nav = (navigator.languages || [navigator.language || 'en']).map((l) => l.slice(0, 2).toLowerCase());
  return nav.find((l) => DICT[l]) || 'en';
}

export function getLang() { return lang; }
export function setLang(l) {
  if (!DICT[l]) return;
  lang = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignoruj */ }
  applyDom();
}

/** Tłumaczenie klucza z podstawieniem {param}. */
export function t(key, params = {}) {
  const s = DICT[lang][key] ?? DICT.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

/** Nazwa elementu katalogu w bieżącym języku. */
export function pieceName(def) {
  return typeof def.name === 'string' ? def.name : (def.name[lang] ?? def.name.en);
}

/** Podstawia teksty w DOM: [data-i18n] → textContent, [data-i18n-title] → title, [data-i18n-placeholder]. */
export function applyDom(root = document) {
  document.documentElement.lang = lang;
  document.title = t('app.title');
  document.querySelector('meta[name=description]')?.setAttribute('content', t('app.description'));
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}
