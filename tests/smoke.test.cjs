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
  const { srv, url } = await serve();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const hook = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
  };

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
  check(exported.version === 1 && exported.pieces.length === 2, 'eksport JSON: poprawna struktura');
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
