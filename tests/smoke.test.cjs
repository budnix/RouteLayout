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

  // normalizacja: tolerancja na drżenie vs. prawdziwy S-kształt
  {
    const { normalizeStroke } = await import('../js/fitter.js');
    const { prepareStroke } = await import('../js/fitter.js');
    const { segment } = await import('../js/normalize.js');
    // 1) prosta 900 mm z silnym drżeniem ±14 mm (okres ~270 mm) -> jedna prosta
    const wob = []; for (let x = 0; x <= 900; x += 5) wob.push([100 + x, 500 + 14 * Math.sin(x / 43)]);
    const primsW = segment(prepareStroke(wob));
    check(primsW.length === 1 && primsW[0].type === 'line', `normalizacja: drżenie ±14 mm → jedna prosta (${primsW.map((p) => p.type).join(',')})`);
    // 2) S-kształt: R2 30° w lewo + R2 30° w prawo (przesunięcie równoległe 113 mm) -> dwa łuki, nie prosta
    const R = 421.88, sc = [];
    for (let a = 0; a <= 30; a += 1) sc.push([100 + R * Math.sin(a * Math.PI / 180), 500 + R * (1 - Math.cos(a * Math.PI / 180))]);
    const [ex, ey] = sc[sc.length - 1];
    for (let a = 1; a <= 30; a += 1) { const b = (30 - a) * Math.PI / 180; sc.push([ex + R * (Math.sin(30 * Math.PI / 180) - Math.sin(b)), ey + R * (Math.cos(b) - Math.cos(30 * Math.PI / 180))]); }
    const primsS = segment(prepareStroke(sc));
    const arcsS = primsS.filter((p) => p.type === 'arc');
    check(arcsS.length === 2 && arcsS[0].dir !== arcsS[1].dir, `normalizacja: S z 2 × R2 30° zostaje dwoma łukami (${primsS.map((p) => p.type + (p.dir || '')).join(',')})`);
    const live = normalizeStroke(wob, new Layout());
    check(live && live.length === 2, 'normalizacja na żywo: drżąca prosta → 2 punkty');
  }

  // ---- przypadki brzegowe normalizacji (paleta PIKO jako wiedza o zamiarze) ----
  {
    const { prepareStroke, normalizeStroke } = await import('../js/fitter.js');
    const { segment, idealPath } = await import('../js/normalize.js');
    const d2r = (d) => (d * Math.PI) / 180;
    // generator kresek: pose = {x,y,a}; line(L), arc(r, sweep, dir) – punkty co 5 mm
    const gen = (start, ops, jitter = 0) => {
      let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
      const pts = [[start.x, start.y]]; let p = { ...start };
      for (const op of ops) {
        if (op.line) { const n = Math.ceil(op.line / 5); for (let i = 1; i <= n; i++) { const t = (op.line * i) / n; pts.push([p.x + t * Math.cos(d2r(p.a)), p.y + t * Math.sin(d2r(p.a))]); } p = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], a: p.a }; }
        else { const { r, sweep, dir } = op; const cx = p.x - dir * r * Math.sin(d2r(p.a)), cy = p.y + dir * r * Math.cos(d2r(p.a)); const a0 = p.a - dir * 90; const n = Math.ceil((d2r(sweep) * r) / 5);
          for (let i = 1; i <= n; i++) { const a = d2r(a0 + (dir * sweep * i) / n); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
          p = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], a: p.a + dir * sweep }; }
      }
      return jitter ? pts.map(([x, y]) => [x + rnd() * jitter, y + rnd() * jitter]) : pts;
    };
    const prims = (pts) => segment(prepareStroke(pts));
    const path = (pts) => { const st = prepareStroke(pts); const pr = segment(st); return idealPath(st, pr, { x: st.pts[0][0], y: st.pts[0][1], a: st.tan[0] }).path; };
    const desc = (pr) => pr.map((p) => p.type + (p.type === 'arc' ? `(r${p.r.toFixed(0)})` : '')).join(',');
    const S = { x: 100, y: 500, a: 0 };

    // 1. długi ciasny łuk (r=250 < R1, 90°): zamiar "jak najciaśniej" → łuk R1, 90°
    let pa = path(gen(S, [{ line: 300 }, { r: 250, sweep: 90, dir: 1 }, { line: 200 }]));
    check(pa.length === 3 && pa[1].type === 'arc' && pa[1].radius.r === 360 && pa[1].sweep === 90, 'brzeg: ciasny długi łuk r=250 → R1 90° (' + JSON.stringify(pa.map((p) => p.type === 'arc' ? [p.radius.r, p.sweep] : Math.round(p.L))) + ')');
    // 2a. ciasne załamanie 20° (r=250), które TRWA (prosta 0° → prosta 20°): zamiar → łuk R1 (22,5° z siatki 7,5°)
    pa = path(gen(S, [{ line: 300 }, { r: 250, sweep: 20, dir: 1 }, { line: 300 }]));
    check(pa.length === 3 && pa[1].type === 'arc' && pa[1].radius.r === 360 && pa[1].sweep === 22.5, 'brzeg: trwałe załamanie 20° r=250 → R1 22,5° (' + JSON.stringify(pa.map((p) => p.type === 'arc' ? [p.radius.r, p.sweep] : Math.round(p.L))) + ')');
    // 2b. ciasne wychylenie i powrót (r=250, +20° i −20°) w prostej: drżenie → jedna prosta
    let pr = prims(gen(S, [{ line: 300 }, { r: 250, sweep: 20, dir: 1 }, { r: 250, sweep: 20, dir: -1 }, { line: 300 }]));
    check(pr.length === 1 && pr[0].type === 'line', 'brzeg: ciasne wychylenie i powrót → prosta (' + desc(pr) + ')');
    // 3. przeciwłuk R9 15° (rozstaw równoległy) między prostymi zostaje łukiem R9 15°
    pa = path(gen(S, [{ line: 300 }, { r: 907.97, sweep: 15, dir: 1 }, { r: 907.97, sweep: 15, dir: -1 }, { line: 300 }], 3));
    const arcs9 = pa.filter((p) => p.type === 'arc');
    check(arcs9.length === 2 && arcs9.every((p) => p.radius.r === 907.97 && p.sweep === 15), 'brzeg: przeciwłuki R9 15°/15° zachowane (' + JSON.stringify(pa.map((p) => p.type === 'arc' ? [p.radius.r, p.sweep, p.dir] : Math.round(p.L))) + ')');
    // 4. załamanie 5° w prostej (dwie proste pod 0° i 5°) → jedna prosta
    pr = prims(gen(S, [{ line: 400 }, { r: 2500, sweep: 5, dir: 1 }, { line: 400 }]));
    check(pr.length === 1 && pr[0].type === 'line', 'brzeg: załamanie 5° → jedna prosta (' + desc(pr) + ')');
    // 5. łuk 45° r≈430 → R2 z kątem 45° (R2 ma elementy 7,5°); r≈480 → R3 tylko 30° lub 60°
    pa = path(gen(S, [{ line: 300 }, { r: 430, sweep: 45, dir: 1 }, { line: 300 }], 2));
    check(pa[1]?.type === 'arc' && pa[1].radius.r === 421.88 && pa[1].sweep === 45, 'brzeg: łuk 45° r=430 → R2 45° (' + JSON.stringify(pa.map((p) => p.type === 'arc' ? [p.radius.r, p.sweep] : Math.round(p.L))) + ')');
    pa = path(gen(S, [{ line: 300 }, { r: 484, sweep: 45, dir: 1 }, { line: 300 }], 2));
    check(pa[1]?.type === 'arc' && pa[1].radius.r === 483.75 && (pa[1].sweep === 30 || pa[1].sweep === 60), 'brzeg: łuk 45° r=484 → R3 z kątem 30/60 (siatka R3) (' + pa[1]?.sweep + ')');
    // 6. łuk 270° (prawie pełny okrąg) r=430 → jeden łuk R2 270°
    pa = path(gen(S, [{ line: 200 }, { r: 430, sweep: 270, dir: 1 }]));
    check(pa[1]?.type === 'arc' && pa[1].radius.r === 421.88 && pa[1].sweep === 270, 'brzeg: łuk 270° → R2 270° (' + JSON.stringify(pa.map((p) => p.type === 'arc' ? [p.radius.r, p.sweep] : Math.round(p.L))) + ')');
    // 7. kreska < 60 mm → ignorowana
    check(normalizeStroke(gen(S, [{ line: 40 }]), new Layout()) === null, 'brzeg: kreska 40 mm ignorowana');
    // 8. kierunek startu snapowany do 15°: prosta pod 22° → 15°; pod 8° → 15°? nie: 8° → 15 (najbliższe) / 6° → 0
    pa = path(gen({ x: 100, y: 500, a: 22 }, [{ line: 500 }]));
    const st22 = prepareStroke(gen({ x: 100, y: 500, a: 22 }, [{ line: 500 }])); const ip22 = idealPath(st22, segment(st22), { x: st22.pts[0][0], y: st22.pts[0][1], a: st22.tan[0] });
    const st6 = prepareStroke(gen({ x: 100, y: 500, a: 6 }, [{ line: 500 }])); const ip6 = idealPath(st6, segment(st6), { x: st6.pts[0][0], y: st6.pts[0][1], a: st6.tan[0] });
    check(ip22.start.a === 15 && ip6.start.a === 0, `brzeg: kierunek startu 22° → ${ip22.start.a}°, 6° → ${ip6.start.a}°`);
    // 9. doczepienie do otwartego końca: kreska zaczęta 20 mm od portu pod 10° różnicy → start dokładnie w porcie, kierunek portu
    const Lp = new Layout(); const base = Lp.add('55200', { x: 500, y: 500, rot: 0 });
    const port = Lp.portOf(base, 1); // (739.07, 500) a=0
    const near = gen({ x: port.x + 15, y: port.y + 12, a: 10 }, [{ line: 400 }]);
    const nz = normalizeStroke(near, Lp);
    check(nz && Math.abs(nz[0][0] - port.x) < 0.01 && Math.abs(nz[0][1] - port.y) < 0.01 && Math.abs(nz[1][1] - port.y) < 0.01, 'brzeg: kreska przy otwartym końcu startuje z portu i w jego kierunku');
    // 10. kreska rysowana W STRONĘ portu (koniec przy porcie): wynik zachowuje kierunek rysowania, ostatni punkt = port
    const toward = gen({ x: port.x + 400, y: port.y + 10, a: 180 }, [{ line: 385 }]);
    const nt = normalizeStroke(toward, Lp);
    check(nt && Math.abs(nt[nt.length - 1][0] - port.x) < 0.01 && Math.abs(nt[nt.length - 1][1] - port.y) < 0.01, 'brzeg: kreska w stronę portu kończy się dokładnie w porcie');
    // 11. zygzak z ręki na prostej z szumem ±5 mm (realistyczny iPad) → jedna prosta
    pr = prims(gen(S, [{ line: 800 }], 10));
    check(pr.length === 1 && pr[0].type === 'line', 'brzeg: prosta z szumem ±5 mm → jedna prosta (' + desc(pr) + ')');
    // 12. łuk R2 30° z szumem ±5 mm między prostymi → dokładnie R2 30°
    pa = path(gen(S, [{ line: 300 }, { r: 421.88, sweep: 30, dir: -1 }, { line: 300 }], 10));
    check(pa.length === 3 && pa[1].type === 'arc' && pa[1].radius.r === 421.88 && pa[1].sweep === 30 && pa[1].dir === -1, 'brzeg: R2 30° w prawo z szumem → R2 30° w prawo (' + JSON.stringify(pa.map((p) => p.type === 'arc' ? [p.radius.r, p.sweep, p.dir] : Math.round(p.L))) + ')');
  }

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
    window.__routelayout.insert('55220', 0);                 // WL, kursor -> port 1 (prosto)
    window.__routelayout.insert('55200');                 // G239 za prostą
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

  // kolor makiety: swatch + zapis + 3D
  await page.click('#btn-menu');
  await page.click('#swatches button[data-color="#c9a76b"]');
  const boardColor = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).board.color);
  check(boardColor === '#c9a76b', 'kolor makiety: sklejka zapisana w układzie');
  await page.click('#menu button[data-close]');
  await page.click('#tab-3d'); await page.waitForTimeout(600);
  const shot2 = await page.locator('#view3d canvas').screenshot();
  const px2 = await page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return [...g.getImageData(Math.floor(img.width / 2), Math.floor(img.height * 0.7), 1, 1).data]; }, shot2.toString('base64'));
  check(px2[0] > px2[2] + 30, `kolor makiety: blat w 3D beżowy (${px2.slice(0, 3)})`);
  await page.click('#tab-2d');
  await page.click('#btn-menu'); await page.click('#swatches button[data-color="#5f8f4a"]'); await page.click('#menu button[data-close]');

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
  for (let i = 1; i <= 40; i++) await page.mouse.move(sx + i * 6, sy + Math.sin(i / 2) * 3);
  for (let a = 0; a <= 90; a += 3) { const r = 120; await page.mouse.move(sx + 240 + r * Math.sin(a * Math.PI / 180), sy + r - r * Math.cos(a * Math.PI / 180)); }
  await page.mouse.up();
  // normalizacja na żywo: krzywa z ręki po puszczeniu myszy jest prostą + łukiem (łamana, nie 41 surowych punktów)
  const live = await page.evaluate(() => {
    const st = window.__routelayout.editor.strokes[0];
    // pierwsza część (prosta): wszystkie punkty do ~240 px w prawo leżą na jednej linii
    const [x0, y0] = st[0]; const [x1, y1] = st[1];
    const straightLen = Math.hypot(x1 - x0, y1 - y0);
    return { n: st.length, straightLen, dy: Math.abs(y1 - y0) };
  });
  check(live.n < 30 && live.straightLen > 200 && live.dy < 0.01, `normalizacja na żywo: kreska → prosta ${live.straightLen.toFixed(0)} mm + łuk (${live.n} pkt)`);
  const nStrokes = await page.evaluate(() => window.__routelayout.editor.strokes.length);
  check(nStrokes === 1, 'rysowanie: kreska zarejestrowana');
  await page.click('#btn-finish');
  const fitted = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).pieces);
  check(fitted.length >= 3 && fitted.some((p) => p.id.startsWith('5521')), 'rysowanie: szkic zamieniony na proste i łuki');
  const m1 = await page.evaluate(() => window.__routelayout.lastFit.method);
  check(m1 === 'normalized', 'rysowanie: z „Normalizuj linie” użyta normalizacja');
  // to samo bez poprawiania: tor dosłownie za kreską (metoda zachłanna), ustawienie zapamiętane
  await page.click('#btn-new'); await page.click('#btn-fit2d'); await page.click('#btn-draw');
  await page.uncheck('#chk-fix');
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(sx + i * 6, sy + Math.sin(i / 3) * 4);
  await page.mouse.up();
  await page.click('#btn-finish');
  const m2 = await page.evaluate(() => ({ m: window.__routelayout.lastFit.method, pref: localStorage.getItem('routelayout.fix'), n: window.__routelayout.layout.pieces.length }));
  check(m2.m === 'greedy' && m2.pref === '0' && m2.n > 0, `rysowanie: bez poprawiania metoda zachłanna (${m2.n} el.), ustawienie zapamiętane`);
  await page.click('#btn-draw'); await page.check('#chk-fix'); await page.click('#btn-draw');
  await page.screenshot({ path: path.join(OUT, 'desktop-fitted.png') });

  // sceneria: wstaw drzewo i drogę, zmień rozmiar drogi, sprawdź zapis i 3D
  const scen = await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
    window.__routelayout.insert('conifer');
    window.__routelayout.insert('road');
    set('in-sel-w', 900); set('in-sel-h', 80);
    document.querySelector('#pal-tabs button[data-tab="scenery"]').click();
    const entryHidden = document.getElementById('entry-row').classList.contains('hidden');
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
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; window.__routelayout.insert('road'); });
  await page.click('#btn-del');
  const afterDel = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).scenery.length);
  check(meshes === 1 && afterDel === 14, 'sceneria: usunięcie zaznaczonego obiektu');
  await page.evaluate(() => document.querySelector('#pal-tabs button[data-tab="piko"]').click());

  // obrotnica w UI: wstaw, stuknij obrzeże, doklej prostą, ustaw nachylenie, 3D
  await page.click('#btn-new');
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; window.__routelayout.insert('TT'); });
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
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; window.__routelayout.insert('55200'); set('in-sel-g', 4); });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('routelayout.v1')).pieces);
  check(after.length === 2 && after[1].id === '55200' && after[1].rot === 120 && Math.abs(after[1].dz - 9.5628) < 0.01, 'obrotnica UI: prosta doklejona do portu 120°, nachylenie 4% z panelu');
  await page.click('#tab-3d'); await page.click('#btn-fit3d'); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-turntable-3d.png') });
  await page.click('#tab-2d');

  // chowanie panelu bocznego: canvas 2D rośnie, stan zapamiętany
  await page.click('#tab-2d');
  const wBefore = await page.evaluate(() => document.getElementById('canvas2d').clientWidth);
  await page.click('#btn-side'); await page.waitForTimeout(200);
  const wAfter = await page.evaluate(() => document.getElementById('canvas2d').clientWidth);
  const sideSaved = await page.evaluate(() => localStorage.getItem('routelayout.side'));
  check(wAfter > wBefore + 300 && sideSaved === '1', `panel boczny: schowany, canvas ${wBefore} → ${wAfter} px`);
  await page.click('#btn-side'); await page.waitForTimeout(200);

  // paleta-lista: klik w wiersz wstawia element, przycisk „w prawo” przy łuku daje skręt w drugą stronę
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); document.querySelector('#pal-tabs button[data-tab="piko"]').click(); });
  const rows = await page.evaluate(() => ({ n: document.querySelectorAll('.pal-item').length, sections: [...document.querySelectorAll('.pal-section')].map((e) => e.textContent), icons: document.querySelectorAll('.pal-item svg.pal-icon path').length }));
  check(rows.n >= 28 && rows.sections.length === 5 && rows.icons >= 28, `paleta: ${rows.n} wierszy w ${rows.sections.length} sekcjach, miniatury SVG`);
  await page.click('.pal-item[data-id="55200"]');
  await page.click('.pal-item[data-id="55212"] button[data-entry="1"]');
  const palState = await page.evaluate(() => window.__routelayout.layout.pieces.map((p) => [p.id, Math.round(p.rot)]));
  // R2 portem 1 za prostą (kierunek 0°): rot = 180 − 30 = 150 → łuk skręca w prawo (wyjście pod −30°)
  check(palState.length === 2 && palState[1][0] === '55212' && palState[1][1] === 150, 'paleta: prosta + R2 „w prawo” (wejście portem 1) (' + JSON.stringify(palState) + ')');
  await page.evaluate(() => document.querySelector('#pal-tabs button[data-tab="scenery"]').click());
  await page.click('.pal-item[data-type="house"]');
  const scen1 = await page.evaluate(() => window.__routelayout.layout.scenery.length);
  check(scen1 === 1, 'paleta: zakładka Sceneria wstawia obiekt z listy');
  await page.evaluate(() => document.querySelector('#pal-tabs button[data-tab="piko"]').click());

  // i18n: przełączenie na DE zmienia teksty UI i nazwy w katalogu
  const de = await page.evaluate(() => {
    const sel = document.getElementById('sel-lang'); sel.value = 'de'; sel.dispatchEvent(new Event('change'));
    document.querySelector('#pal-tabs button[data-tab="piko"]').click();
    return { tab: document.querySelector('#pal-tabs button[data-tab="piko"]').textContent, group: document.querySelector('.pal-section').textContent,
      piece: document.querySelector('.pal-item .pal-desc').textContent, lang: document.documentElement.lang };
  });
  check(de.lang === 'de' && de.tab.includes('PIKO') && de.group === 'Gerade Gleise' && de.piece.includes('Gerades Gleis'), 'i18n: przełączenie na DE tłumaczy UI i katalog');
  const pl = await page.evaluate(() => { const sel = document.getElementById('sel-lang'); sel.value = 'pl'; sel.dispatchEvent(new Event('change')); return document.querySelector('#pal-tabs button[data-tab="scenery"]').textContent; });
  check(pl.includes('Sceneria'), 'i18n: powrót do PL');

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
