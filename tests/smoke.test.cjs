// Test dymny: uruchamia aplikację w headless Chromium, sprawdza brak błędów,
// auto-rysowanie, BOM, import/eksport oraz widoki desktop/telefon.
// Uruchomienie: npm test  (wymaga: npx playwright install chromium)

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-results');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // ---- algorytm dopasowania (Node, bez przeglądarki) ----
  const { fitStrokes, deviation } = await import('../js/fitter.js');
  const { Layout } = await import('../js/layout.js');
  const s1 = [];
  for (let x = 100; x <= 820; x += 6) s1.push([x, 300]);
  for (let a = 0; a <= 90; a += 1.5) { const r = 430; s1.push([820 + r * Math.sin(a * Math.PI / 180), 300 + r - r * Math.cos(a * Math.PI / 180)]); }
  const s2 = []; for (let d = 0; d <= 500; d += 6) s2.push([400 + d * Math.cos(0.26), 300 + d * Math.sin(0.26)]);
  const fit = fitStrokes([s1, s2], new Layout());
  const ids = fit.pieces.map((p) => p.id);
  check(ids.filter((i) => i === '55212').length === 3, 'fitter: łuk r≈430 mm → 3 × R2 (' + ids.join(',') + ')');
  check(ids.includes('55220') || ids.includes('55221'), 'fitter: odgałęzienie rozpoznane jako rozjazd');
  const dev = deviation(fit.pieces.filter((p) => p.y < 900), s1);
  check(dev < 25, `fitter: średnie odchylenie od kreski ${dev.toFixed(1)} mm < 25`);
  const lay = new Layout(); lay.addMany(fit.pieces);
  check(lay.openPorts().length === 3, 'fitter: elementy połączone (3 otwarte końce: start, koniec, odgałęzienie)');
  // ta sama kreska z szumem ±7 mm (drżąca ręka): normalizacja ma dać tę samą geometrię
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const noisy = (pts) => pts.map(([x, y]) => [x + rnd() * 14, y + rnd() * 14]);
  const fitN = fitStrokes([noisy(s1), noisy(s2)], new Layout());
  const idsN = fitN.pieces.map((p) => p.id);
  check(fitN.method === 'normalized' && idsN.filter((i) => i === '55212').length === 3 && (idsN.includes('55220') || idsN.includes('55221')),
    'fitter: z szumem ±7 mm nadal 3 × R2 + rozjazd, metoda ' + fitN.method + ' (' + idsN.join(',') + ')');
  const layN = new Layout(); layN.addMany(fitN.pieces);
  check(layN.openPorts().length === 3, 'fitter: z szumem elementy nadal połączone');
  const { srv, url } = await serve();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const hook = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
  };

  // obrotnica + wysokości (model, Node)
  {
    const L = new Layout();
    const tt = L.add('TT', { x: 500, y: 500, rot: 0 });
    const rim = L.addRimPort(tt, 37);
    const a = L.attach('55200', 0, rim);
    check(rim && a.rot === 37 && L.openPorts().length === 3, 'obrotnica: port na obrzeżu pod 37°, prosta doczepiona (rot 37)');
    L.setGrade(a, 3); const b = L.attach('55200', 0, L.portOf(a, 1));
    check(Math.abs(b.dz - 7.172) < 0.01 && Math.abs(b.z - 7.172) < 0.01, 'wysokości: nachylenie 3% dziedziczone przez kolejny element');
    L.setHeight(a, 50);
    check(a.z === 50 && Math.abs(b.z - 57.172) < 0.01 && tt.z === 50 && L.openPorts().length === 3, 'wysokości: zmiana wysokości przesuwa całą połączoną grupę, połączenia zachowane');
    b.z += 20; L._portCache = null;
    check(L.openPorts().length === 5, 'wysokości: porty na różnych wysokościach nie łączą się');
    const M = new Layout(); M.load(L.toJSON());
    check(M.pieces[0].angles.length === 1 && M.pieces[1].z === 50, 'obrotnica/wysokości: zapis i odczyt JSON');
  }

  // ---- desktop ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  hook(page, 'desktop');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-split.png') });

  const demo = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')));
  check(demo && demo.pieces.length === 18, 'demo: pętla z 18 elementów zapisana w localStorage');

  // auto-rysowanie: wyczyść, wstaw WL, potem R9 na odgałęzienie – końce muszą się zgadzać z geometrią Piko
  const auto = await page.evaluate(async () => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
    window.confirm = () => true;
    document.getElementById('btn-menu').click();
    document.getElementById('btn-clear').click();
    document.querySelector('#menu [data-close]').click();
    set('sel-group', 'turnout'); set('sel-piece', '55220'); set('sel-entry', '0');
    document.getElementById('btn-add').click();                 // WL, kursor -> port 1 (prosto)
    set('sel-group', 'straight'); set('sel-piece', '55200');
    document.getElementById('btn-add').click();                 // G239 za prostą
    const s = JSON.parse(localStorage.getItem('routelayout.v1'));
    return s.pieces;
  });
  check(auto.length === 2, 'auto-rysowanie: 2 elementy po wstawieniu WL + G239');
  check(auto[1] && Math.abs(auto[1].x - auto[0].x - 239.07) < 0.01 && Math.abs(auto[1].y - auto[0].y) < 0.01 && Math.abs(auto[1].rot) < 0.01,
    'auto-rysowanie: prosta doklejona dokładnie na końcu prostego toru rozjazdu');

  // BOM
  await page.click('#btn-menu');
  const bom = await page.locator('#bom').innerText();
  check(/1 ×\s*55220/.test(bom) && /1 ×\s*55200/.test(bom), 'BOM: liczy 55220 i 55200');
  await page.screenshot({ path: path.join(OUT, 'desktop-menu.png') });
  await page.click('#menu button[data-close]');

  // eksport JSON -> import JSON
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-menu').then(() => page.click('#btn-export'))]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check(exported.version === 2 && exported.pieces.length === 2 && Array.isArray(exported.scenery), 'eksport JSON: poprawna struktura v2');
  await page.setInputFiles('#file-import', { name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, name: 'T', board: { w: 1500, h: 900 }, pieces: [{ id: '55212', x: 100, y: 100, rot: 0 }, { id: '55224', x: 500, y: 500, rot: 15 }] })) });
  await page.waitForTimeout(300);
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')));
  check(imported.pieces.length === 2 && imported.board.w === 1500, 'import JSON: wczytuje elementy i blat');

  // 3D
  await page.click('#tab-3d');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'desktop-3d.png') });
  const hasGl = await page.evaluate(() => !!document.querySelector('#view3d canvas'));
  check(hasGl, '3D: canvas WebGL istnieje');

  // undo
  await page.click('#tab-2d');
  await page.click('#btn-undo');
  const afterUndo = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).pieces.length);
  check(afterUndo === 2, 'undo: przywraca stan sprzed importu (2 elementy)');

  // nowy układ: przycisk czyści wszystko, a po przeładowaniu demo NIE wraca
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); });
  const afterNew = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).pieces.length);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).pieces.length);
  check(afterNew === 0 && afterReload === 0, 'nowy układ: pusty i pozostaje pusty po przeładowaniu');
  // nowy układ w 3D: blat musi być w kadrze (kamera celuje w środek blatu)
  await page.click('#tab-3d'); await page.waitForTimeout(400);
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); });
  await page.waitForTimeout(600);
  const shot = await page.locator('#view3d canvas').screenshot();
  const boardPx = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return [...g.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data];
  }, shot.toString('base64'));
  check(boardPx[1] > boardPx[0] && boardPx[1] > boardPx[2], `nowy układ w 3D: środek ekranu to zielony blat (${boardPx.slice(0, 3)})`);
  await page.click('#tab-2d');

  // tryb rysowania: kreska myszą (prosta 600 mm + łuk) -> po "Zakończ" powstają tory
  await page.click('#btn-new');
  await page.click('#btn-fit2d');
  await page.click('#btn-draw');
  const drawn = await page.evaluate(() => document.getElementById('draw-bar').classList.contains('hidden') === false);
  check(drawn, 'rysowanie: pasek narzędzi szkicu widoczny');
  await page.check('#chk-grid');
  const gridOn = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.grid')).enabled);
  check(gridOn, 'rysowanie: siatka pomocnicza zapisana w ustawieniach');
  const box = await page.locator('#canvas2d').boundingBox();
  const sx = box.x + 60, sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(sx + i * 6, sy);
  for (let a = 0; a <= 90; a += 3) { const r = 120; await page.mouse.move(sx + 240 + r * Math.sin(a * Math.PI / 180), sy + r - r * Math.cos(a * Math.PI / 180)); }
  await page.mouse.up();
  const nStrokes = await page.evaluate(() => document.getElementById('btn-finish').disabled);
  check(nStrokes === false, 'rysowanie: kreska zarejestrowana');
  await page.click('#btn-finish');
  const fitted = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).pieces);
  check(fitted.length >= 3 && fitted.some((p) => p.id.startsWith('5521')), 'rysowanie: szkic zamieniony na proste i łuki');
  await page.screenshot({ path: path.join(OUT, 'desktop-fitted.png') });

  // sceneria: wstaw drzewo i drogę, zmień rozmiar drogi, sprawdź zapis i 3D
  const scen = await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
    set('sel-group', 'trees'); set('sel-piece', 'conifer'); document.getElementById('btn-add').click();
    set('sel-group', 'infra'); set('sel-piece', 'road'); document.getElementById('btn-add').click();
    set('in-sel-w', 900); set('in-sel-h', 80);
    const entryHidden = document.getElementById('sel-entry').parentElement.classList.contains('hidden');
    const s = JSON.parse(localStorage.getItem('routelayout.v1'));
    return { entryHidden, scenery: s.scenery, version: s.version, name: document.getElementById('sel-name').textContent };
  });
  check(scen.entryHidden && scen.scenery.length === 2 && scen.scenery[0].type === 'conifer', 'sceneria: drzewo i droga wstawione, zapisane w JSON v' + scen.version);
  check(scen.scenery[1].w === 900 && scen.scenery[1].h === 80, 'sceneria: rozmiar drogi z panelu zaznaczenia (900×80)');
  await page.click('#btn-rot-r');
  const rot = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).scenery[1].rot);
  check(rot === 15, 'sceneria: obrót zaznaczonego obiektu o 15°');
  await page.click('#tab-3d'); await page.waitForTimeout(800);
  const meshes = await page.evaluate(() => document.querySelector('#view3d canvas') ? 1 : 0);
  await page.screenshot({ path: path.join(OUT, 'desktop-scenery-3d.png') });
  await page.click('#tab-2d');
  await page.screenshot({ path: path.join(OUT, 'desktop-scenery-2d.png') });
  // przegląd wszystkich typów scenerii w 3D (zrzut do README / kontrola wizualna)
  await page.click('#btn-new');
  await page.evaluate(async () => {
    const { SCENERY } = await import('./js/scenery.js');
    const scenery = Object.entries(SCENERY).map(([type, def], i) => ({ type, x: 250 + (i % 5) * 380, y: 220 + Math.floor(i / 5) * 300, rot: 0, w: def.w, h: def.h }));
    localStorage.setItem('routelayout.v1', JSON.stringify({ version: 2, name: 'Scenery', board: { w: 2000, h: 1000 }, pieces: [], scenery }));
  });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const nTypes = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).scenery.length);
  check(nTypes === 14, 'sceneria: wszystkie 14 typów wstawione i wczytane po przeładowaniu');
  await page.click('#tab-3d'); await page.click('#btn-fit3d'); await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'desktop-scenery-all.png') });
  await page.click('#tab-2d');
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; set('sel-group', 'infra'); set('sel-piece', 'road'); document.getElementById('btn-add').click(); });
  await page.click('#btn-del');
  const afterDel = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).scenery.length);
  check(meshes === 1 && afterDel === 14, 'sceneria: usunięcie zaznaczonego obiektu');
  await page.evaluate(() => { document.getElementById('sel-group').value = 'straight'; document.getElementById('sel-group').dispatchEvent(new Event('change')); });

  // obrotnica w UI: wstaw, stuknij obrzeże, doklej prostą, ustaw nachylenie, 3D
  await page.click('#btn-new');
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; set('sel-group', 'accessory'); set('sel-piece', 'TT'); document.getElementById('btn-add').click(); });
  await page.click('#btn-fit2d');
  const ttInfo = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('routelayout.v1')); return s.pieces[0]; });
  // stuknięcie w obrzeże pod kątem 120° tworzy tam port i ustawia kursor
  const rimPx = await page.evaluate((tt) => {
    const { editor } = window.__routelayout; const a = 120 * Math.PI / 180;
    const p = editor.toScreen(tt.x + tt.r * Math.cos(a), tt.y + tt.r * Math.sin(a));
    const r = editor.canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y };
  }, ttInfo);
  await page.mouse.click(rimPx.x, rimPx.y);
  const rimState = await page.evaluate(() => { const { layout, editor } = window.__routelayout; const c = editor.cursorPort(); return { angles: layout.pieces[0].angles, cursorA: c && Math.round(c.a) }; });
  check(rimState.angles.includes(120) && rimState.cursorA === 120, 'obrotnica UI: stuknięcie w obrzeże → port pod 120° i kursor');
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; set('sel-group', 'straight'); set('sel-piece', '55200'); document.getElementById('btn-add').click(); set('in-sel-g', 4); });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).pieces);
  check(after.length === 2 && after[1].id === '55200' && after[1].rot === 120 && Math.abs(after[1].dz - 9.5628) < 0.01, 'obrotnica UI: prosta doklejona do portu 120°, nachylenie 4% z panelu');
  await page.click('#tab-3d'); await page.click('#btn-fit3d'); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-turntable-3d.png') });
  await page.click('#tab-2d');

  // i18n: przełączenie na DE zmienia teksty UI i nazwy w katalogu
  const de = await page.evaluate(() => {
    const sel = document.getElementById('sel-lang'); sel.value = 'de'; sel.dispatchEvent(new Event('change'));
    return { add: document.getElementById('btn-add').textContent, group: document.getElementById('sel-group').selectedOptions[0].text,
      piece: document.getElementById('sel-piece').selectedOptions[0].text, lang: document.documentElement.lang };
  });
  check(de.lang === 'de' && de.add.includes('Einfügen') && de.group === 'Gerade Gleise' && de.piece.includes('Gerades Gleis'), 'i18n: przełączenie na DE tłumaczy UI i katalog');
  const pl = await page.evaluate(() => { const sel = document.getElementById('sel-lang'); sel.value = 'pl'; sel.dispatchEvent(new Event('change')); return document.getElementById('btn-add').textContent; });
  check(pl.includes('Wstaw'), 'i18n: powrót do PL');

  // ---- telefon ----
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  hook(phone, 'phone');
  await phone.goto(url, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(800);
  const menuVisible = await phone.locator('#btn-menu').isVisible();
  const menuBox = await phone.locator('#btn-menu').boundingBox();
  check(menuVisible && menuBox && menuBox.x + menuBox.width <= 390, 'telefon: przycisk menu mieści się na ekranie');
  await phone.screenshot({ path: path.join(OUT, 'phone-2d.png') });
  await phone.tap('#tab-3d');
  await phone.waitForTimeout(1000);
  await phone.screenshot({ path: path.join(OUT, 'phone-3d.png') });

  const realErrors = errors.filter((e) => !/GL Driver Message|swiftshader/i.test(e));
  check(realErrors.length === 0, `brak błędów JS (${realErrors.length})`);
  realErrors.forEach((e) => console.log('   ', e));

  await browser.close();
  srv.close();
  if (failures.length) { console.error(`\n${failures.length} test(y) nie przeszły`); process.exit(1); }
  console.log('\nWszystkie testy przeszły');
})().catch((e) => { console.error(e); process.exit(1); });
