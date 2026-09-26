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

  // ---- szkic: rozjazdy łukowe i skrzyżowania (Node) ----
  {
    const { R: RAD } = await import('../js/catalog.js');
    const d2r = (d) => d * Math.PI / 180;
    const line = (x0, y0, a, L, step = 6) => { const o = []; for (let d = 0; d <= L; d += step) o.push([x0 + d * Math.cos(d2r(a)), y0 + d * Math.sin(d2r(a))]); return o; };
    const arc = (x0, y0, a, R, dir, sweep, step = 1.5) => { const o = []; const cx = x0 - dir * R * Math.sin(d2r(a)), cy = y0 + dir * R * Math.cos(d2r(a)); for (let t = 0; t <= sweep; t += step) { const a1 = a - dir * 90 + dir * t; o.push([cx + R * Math.cos(d2r(a1)), cy + R * Math.sin(d2r(a1))]); } return o; };
    const build = (strokes) => { const f = fitStrokes(strokes, new Layout()); const L = new Layout(); L.setBoard(4000, 3000); L.addMany(f.pieces); return { ids: f.pieces.map((p) => p.id), open: L.openPorts().length }; };
    // odgałęzienie z łuku R3 po wewnętrznym R2 → BWL, tor główny zewnętrzny
    let toe = arc(400, 600, 0, RAD.R3, 1, 30).pop();
    let r = build([[...line(100, 600, 0, 300), ...arc(400, 600, 0, RAD.R3, 1, 90).slice(1)], arc(toe[0], toe[1], 30, RAD.R2, 1, 60)]);
    check(r.ids.includes('55222') && r.open === 3 && !r.ids.includes('55220') && !r.ids.includes('55221'), `szkic: odgałęzienie z łuku R3 → rozjazd łukowy BWL, 3 otwarte końce (${r.ids.join(',')})`);
    // tor główny R2, odgałęzienie zewnętrzne R3 → BWL z torem głównym na wewnętrznym łuku (wyjście 2); wzajemne „rodzicielstwo” nie może zapętlić
    toe = arc(400, 600, 0, RAD.R2, 1, 30).pop();
    r = build([[...line(100, 600, 0, 300), ...arc(400, 600, 0, RAD.R2, 1, 90).slice(1)], arc(toe[0], toe[1], 30, RAD.R3, 1, 60)]);
    check(r.ids.includes('55222') && r.open === 3 && r.ids.filter((i) => i === '55212').length === 2, `szkic: tor główny R2 + odnoga R3 → BWL z wyjściem wewnętrznym (${r.ids.join(',')})`);
    // skrzyżowanie 15° → DKW, obie części drugiej kreski doczepione (4 otwarte końce = 2 kreski × 2)
    r = build([line(100, 500, 0, 900), line(300, 500 + 250 * Math.tan(d2r(15)), -15, 520)]);
    check(r.ids.includes('55224') && r.open === 4 && !r.ids.some((i) => i === '55220' || i === '55221'), `szkic: kreski krzyżujące się pod 15° → DKW, bez rozjazdu, 4 otwarte końce (${r.ids.join(',')})`);
    r = build([line(100, 500, 0, 900), line(350, 500 + 200 * Math.tan(d2r(30)), -30, 470)]);
    check(r.ids.includes('55241') && r.open === 4, `szkic: skrzyżowanie 30° → krzyżownica K30 (${r.ids.join(',')})`);
    r = build([line(100, 500, 0, 900), line(450, 500 + 100 * Math.tan(d2r(60)), -60, 240)]);
    check(!r.ids.some((i) => i === '55224' || i === '55240' || i === '55241') && r.open === 4, `szkic: skrzyżowanie 60° nie istnieje w palecie → bez krzyżownicy (${r.ids.join(',')})`);
  }

  // ---- domykanie pętli (solver, Node) ----
  {
    const { closeGap, pickPartner } = await import('../js/closer.js');
    const oval = (chain) => { const L = new Layout(); let p = L.add('55200', { x: 300, y: 300, rot: 0 }); let cur = L.portOf(p, 1); for (const id of chain) { p = L.attach(id, 0, cur); cur = L.portOf(p, 1); } return { L, cur }; };
    const R6 = ['55212', '55212', '55212', '55212', '55212', '55212'];
    const { L, cur } = oval(['55200', ...R6, '55200', '55200', '55200', ...R6]);   // brakuje jednej G239
    const B = pickPartner(L, cur);
    const r = closeGap(cur, B);
    check(B && r.ok && r.pieces.length === 1 && r.pieces[0].id === '55200' && r.error.d < 0.01, 'domykanie: owal bez jednej prostej → G239 (' + JSON.stringify(r.pieces.map((p) => p.id)) + ')');
    L.addMany(r.pieces);
    check(L.openPorts().length === 0, 'domykanie: po dodaniu owal bez otwartych końców');
    const two = (dx, dy) => { const M = new Layout(); const a = M.add('55200', { x: 0, y: 0, rot: 0 }); const b = M.add('55200', { x: 239.07 + dx, y: dy, rot: 0 }); return closeGap(M.portOf(a, 1), M.portOf(b, 0)); };
    const r2 = two(358.61, 0);
    check(r2.ok && r2.pieces.map((p) => p.id).sort().join() === '55200,55202', 'domykanie: szczelina 358,61 mm → G239 + G119');
    const r3 = two(2 * 907.97 * Math.sin(15 * Math.PI / 180), 61.88);
    check(r3.ok && r3.pieces.length === 2 && r3.pieces.every((p) => p.id === '55219'), 'domykanie: przesunięcie równoległe 61,88 mm → R9 + R9');
    const r4 = two(100, 0);
    check(!r4.ok && r4.error.d > 5 && r4.error.d < 10, `domykanie: 100 mm nie do zrobienia (najlepiej ${r4.error.d.toFixed(1)} mm obok)`);
    const r5 = two(3 * 239.07 + 30.94, 0);
    check(r5.ok && r5.pieces.length === 4 && r5.pieces.filter((p) => p.id === '55200').length === 3 && r5.pieces.some((p) => p.id === '55206'), 'domykanie: 748 mm → 3×G239 + G31 (4 elementy) (' + r5.pieces.map((p) => p.id).join(',') + ')');
  }

  // ---- kontrola wykonalności (Node) ----
  {
    const { checkLayout } = await import('../js/checks.js');
    const L = new Layout();
    const a = L.add('55200', { x: 300, y: 300, rot: 0 }); L.setGrade(a, 5);
    L.add('55200', { x: 800, y: 500, rot: 0 }); L.add('55200', { x: 900, y: 400, rot: 90 });
    L.add('55200', { x: 1300, y: 500, rot: 0 }); L.add('55200', { x: 1400, y: 400, rot: 90, z: 30 });
    L.add('55200', { x: 300, y: 800, rot: 0 }); L.add('55200', { x: 300, y: 830, rot: 0 });
    L.add('55200', { x: 1700, y: 990, rot: 0 });
    const types = checkLayout(L).map((p) => p.type).sort();
    check(types.join() === 'clearance,collision,edge,grade,spacing', 'kontrola: nachylenie, kolizja, prześwit, odstęp, krawędź – po jednym (' + types.join(',') + ')');
    const M = new Layout(); let p = M.add('55200', { x: 500, y: 100, rot: 0 }); let cur = M.portOf(p, 1);
    for (const id of ['55200', '55200', '55212', '55212', '55212', '55212', '55212', '55212', '55200', '55200', '55200', '55212', '55212', '55212', '55212', '55212', '55212']) { p = M.attach(id, 0, cur); cur = M.portOf(p, 1); }
    check(checkLayout(M).length === 0, 'kontrola: poprawny owal bez problemów');
    // most: tor 70 mm nad innym – prześwit OK, brak problemu; 40 mm – problem
    const N = new Layout(); N.add('55200', { x: 500, y: 500, rot: 0 }); N.add('55200', { x: 600, y: 400, rot: 90, z: 70 });
    check(checkLayout(N).length === 0, 'kontrola: wiadukt 70 mm nad torem jest OK');
    const O = new Layout(); O.add('55200', { x: 500, y: 500, rot: 0 }); const hi = O.add('55200', { x: 600, y: 400, rot: 90, z: 40 });
    check(checkLayout(O).some((q) => q.type === 'clearance' && q.params.dz === 40) && hi, 'kontrola: wiadukt 40 mm → prześwit za mały');
    // rozjazd: ramiona są jednym elementem, więc bliskość odnogi i prostej nie jest problemem
    const P = new Layout(); P.add('55220', { x: 500, y: 500, rot: 0 });
    check(checkLayout(P).length === 0, 'kontrola: rozjazd sam w sobie nie zgłasza odstępu');
    // odnogi rozjazdu z doczepionymi torami: prosta i R9 blisko siebie przy ostrzu – to nie problem
    const Q = new Layout(); const qa = Q.add('55200', { x: 300, y: 500, rot: 0 }); const qw = Q.attach('55220', 0, Q.portOf(qa, 1)); Q.attach('55200', 0, Q.portOf(qw, 1)); Q.attach('55219', 0, Q.portOf(qw, 2));
    check(checkLayout(Q).length === 0, 'kontrola: tory za rozjazdem (prosta + R9) nie zgłaszają odstępu (' + checkLayout(Q).map((q) => q.type).join(',') + ')');
    // ...ale dwa równoległe tory 30 mm od siebie, które nie mają wspólnego sąsiada – tak
    const S2 = new Layout(); S2.add('55200', { x: 300, y: 800, rot: 0 }); S2.add('55200', { x: 300, y: 830, rot: 0 });
    check(checkLayout(S2).some((q) => q.type === 'spacing'), 'kontrola: równoległe 30 mm bez wspólnego sąsiada → odstęp');
  }

  // ---- obrys taboru: odstęp na łukach i minimalny promień (Node) ----
  {
    const { checkLayout, requiredSpacing, STOCK } = await import('../js/checks.js');
    check(requiredSpacing(Infinity, Infinity, STOCK.long) < 45, `envelope: na prostych wymagany odstęp ${requiredSpacing(Infinity, Infinity, STOCK.long).toFixed(1)} mm < 45 (standard PIKO 61,88 zawsze OK)`);
    const needStd = requiredSpacing(360, 421.88, STOCK.standard, 'outer', 'inner'), needLong = requiredSpacing(360, 421.88, STOCK.long, 'outer', 'inner');
    check(needStd < 61.88 && needLong > 61.88 && requiredSpacing(360, 421.88, STOCK.standard) > needStd, `envelope: R1‖R2 (61,88 mm), strony z geometrii: standard potrzebuje ${needStd.toFixed(1)}, długi ${needLong.toFixed(1)} mm`);
    const L = new Layout(); L.setBoard(2000, 1500);
    L.add('55211', { x: 800, y: 600, rot: 0 });            // R1, środek (800, 960)
    L.add('55212', { x: 800, y: 600 - 61.88, rot: 0 });    // R2 współśrodkowy → odstęp osi 61,88
    const std = checkLayout(L, { stock: 'standard' }), lng = checkLayout(L, { stock: 'long' });
    check(!std.some((p) => p.type === 'envelope' || p.type === 'radius'), `envelope: R1‖R2 ze standardowym taborem bez uwag (${std.map((p) => p.type).join(',') || 'brak'})`);
    check(lng.some((p) => p.type === 'envelope') && lng.some((p) => p.type === 'radius' && p.params.r === 360), `envelope: długi tabor → obrysy zachodzą + R1 za ciasny (${lng.map((p) => p.type).join(',')})`);
    const L2 = new Layout(); L2.setBoard(2000, 1500); L2.add('55200', { x: 200, y: 600, rot: 0 }); L2.add('55200', { x: 200, y: 661.88, rot: 0 });
    check(!checkLayout(L2, { stock: 'long' }).some((p) => p.type === 'envelope' || p.type === 'spacing'), 'envelope: proste równoległe 61,88 mm – bez uwag nawet dla długiego taboru');
  }

  // ---- jazda próbna (Node) ----
  {
    const { Train, toggleSwitch } = await import('../js/train.js');
    const L = new Layout(); const a = L.add('55200', { x: 0, y: 0, rot: 0 }); const wl = L.attach('55220', 0, L.portOf(a, 1)); L.attach('55200', 0, L.portOf(wl, 1)); L.attach('55219', 0, L.portOf(wl, 2));
    const T = new Train(L); T.place(a, 0); T.running = true; T.speed = 200;
    for (let i = 0; i < 20; i++) T.step(0.1);
    check(T.pos.piece.id === '55200' && T.pos.piece !== a && Math.abs(T.pose().y) < 0.01, 'jazda: rozjazd w położeniu 0 → tor prosty');
    for (let i = 0; i < 40; i++) T.step(0.1);
    check(!T.running && Math.abs(T.pose().x - (239.07 * 3)) < 0.5, `jazda: ślepy koniec zatrzymuje (x=${T.pose().x.toFixed(0)})`);
    check(toggleSwitch(wl) === 1 && toggleSwitch(a) === null, 'jazda: przełączenie rozjazdu (prosta nie ma stanu)');
    const T2 = new Train(L); T2.place(a, 0); T2.running = true; T2.speed = 200; for (let i = 0; i < 25; i++) T2.step(0.1);
    check(T2.pos.piece.id === '55219' && T2.carPoses().length === 2, 'jazda: rozjazd w położeniu 1 → odgałęzienie, 2 wagony za lokomotywą');
    T2.reverse(); T2.running = true; for (let i = 0; i < 60; i++) T2.step(0.1);
    check(!T2.running && T2.pos.piece === a && T2.pose().x < 1, 'jazda: nawrót i powrót do początku');
    // pętla: pociąg jedzie bez końca (owal)
    const M = new Layout(); let p = M.add('55200', { x: 500, y: 100, rot: 0 }); let cur = M.portOf(p, 1);
    for (const id of ['55200', '55200', '55212', '55212', '55212', '55212', '55212', '55212', '55200', '55200', '55200', '55212', '55212', '55212', '55212', '55212', '55212']) { p = M.attach(id, 0, cur); cur = M.portOf(p, 1); }
    const T3 = new Train(M); T3.place(M.pieces[0], 0); T3.running = true; T3.speed = 1000; for (let i = 0; i < 100; i++) T3.step(0.1);
    check(T3.running && T3.dist > 9000, `jazda: na owalu bez końca (${T3.dist.toFixed(0)} mm)`);
  }

  // ---- systemy torów (Node) ----
  {
    const { CATALOG, BY_ID, toSystem, SYSTEMS } = await import('../js/catalog.js');
    const bed = CATALOG.filter((p) => p.system === 'piko-a-bed');
    check(Object.keys(SYSTEMS).length === 2 && bed.length === 28 && bed.every((b) => BY_ID[b.base].geo === b.geo && b.id === '554' + b.base.slice(3)), `systemy: ${bed.length} elementów 554xx z geometrią 552xx`);
    check(toSystem('55200', 'piko-a-bed') === '55400' && toSystem('55412', 'piko-a') === '55212' && toSystem('TT', 'piko-a-bed') === 'TT' && toSystem('55280', 'piko-a-bed') === '55280', 'systemy: mapowanie 552↔554, obrotnica i kozioł bez zmian');
    check(BY_ID['55418'].verified !== false && BY_ID['55400'].verified === false, 'systemy: 55418 potwierdzony, pozostałe 554xx do weryfikacji');
  }

  // ---- operacje grupowe (Node) ----
  {
    const L = new Layout(); const a = L.add('55200', { x: 100, y: 100, rot: 0 }); const b = L.attach('55200', 0, L.portOf(a, 1)); const c = L.add('55200', { x: 100, y: 600, rot: 0 });
    const inRect = L.piecesInRect(50, 50, 600, 200);
    check(inRect.length === 2 && inRect.includes(a) && inRect.includes(b), 'grupa: prostokąt zaznacza 2 z 3 elementów');
    L.moveMany([a, b], 50, 20);
    check(a.x === 150 && b.y === 120 && L.openPorts().length === 4 && L.portOf(a, 1).mate, 'grupa: przesunięcie zachowuje połączenie w grupie');
    L.rotateMany([a, b], 90, 150, 120);
    check(Math.abs(a.rot - 90) < 1e-9 && Math.abs(a.x - 150) < 1e-9 && L.portOf(a, 1).mate && L.portOf(a, 1).mate.piece === b, 'grupa: obrót wokół środka zachowuje połączenia');
    L.removeMany([a, b]); check(L.pieces.length === 1 && L.pieces[0] === c, 'grupa: usunięcie'); L.undo(); check(L.pieces.length === 3, 'grupa: usunięcie cofnięte jednym krokiem');
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

  // ---- wydajność: siatka przestrzenna vs. brute force (Node) ----
  {
    const { checkLayout } = await import('../js/checks.js');
    const { SpatialHash } = await import('../js/spatial.js');
    const build = (rows, cols) => {
      const L = new Layout(); L.setBoard(cols * 1500, rows * 800);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let p = L.add('55200', { x: 300 + c * 1400, y: 200 + r * 750, rot: 0 }); let cur = { piece: p, idx: 1 };
        for (const id of ['55200', '55200', '55212', '55212', '55212', '55212', '55212', '55212', '55200', '55220', '55200', '55212', '55212', '55212', '55212', '55212', '55212']) { p = L.attach(id, 0, L.portOf(cur.piece, cur.idx)); cur = { piece: p, idx: 1 }; }
      }
      // dwa niepołączone tory blisko siebie + skrzyżowanie: musi być coś do zgłoszenia
      L.add('55200', { x: 320, y: 120, rot: 0 }); L.add('55200', { x: 500, y: 100, rot: 40 });
      return L;
    };
    const brutePairs = (L) => {
      const all = L.ports(), pairs = new Set();
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.piece !== b.piece && Math.hypot(a.x - b.x, a.y - b.y) <= 0.6 && Math.abs(((a.a - b.a + 180 + 540) % 360) - 180) <= 1 && Math.abs(a.z - b.z) <= 3) pairs.add(`${a.piece.uid}:${a.idx}-${b.piece.uid}:${b.idx}`);
      }
      return pairs;
    };
    const small = build(5, 4), big = build(10, 8);
    const gridPairs = new Set(small.ports().filter((p) => p.mate && p.piece.uid < p.mate.piece.uid).map((p) => `${p.piece.uid}:${p.idx}-${p.mate.piece.uid}:${p.mate.idx}`));
    const ref = brutePairs(small);
    check(gridPairs.size === ref.size && [...gridPairs].every((k) => ref.has(k)), `spatial: parowanie portów = brute force (${gridPairs.size} par, ${small.pieces.length} elementów)`);
    check(small.portOf(small.pieces[3], 1) === small.ports().find((p) => p.piece === small.pieces[3] && p.idx === 1), 'spatial: portOf przez mapę zwraca ten sam obiekt');
    // pary z siatki ⊇ pary o przecinających się obwiedniach
    const boxes = [[0, 0, 100, 100], [90, 90, 200, 200], [500, 500, 600, 600], [-50, 150, 20, 260], [95, 0, 105, 300]];
    const g = new SpatialHash(250); boxes.forEach((b, i) => g.addBox(b[0], b[1], b[2], b[3], i));
    const gp = new Set(g.pairs().map(([a, b]) => `${a}-${b}`));
    const overlaps = []; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (!(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1])) overlaps.push(`${i}-${j}`); }
    check(overlaps.length === 3 && overlaps.every((k) => gp.has(k)) && !gp.has('0-2'), 'spatial: pairs() zawiera każdą przecinającą się parę obwiedni i pomija odległe');
    const probs = checkLayout(small);
    check(probs.some((p) => p.type === 'collision') && probs.some((p) => p.type === 'spacing'), `checks: siatka znajduje kolizję i za mały odstęp (${probs.length} problemów)`);
    const best = (fn, n = 5) => { let b = Infinity; for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(); b = Math.min(b, performance.now() - t0); } return b; };
    const tPortsS = best(() => { small._portCache = null; small.ports(); }), tPortsB = best(() => { big._portCache = null; big.ports(); });
    const tChkS = best(() => { small._segCache.clear(); checkLayout(small); }), tChkB = best(() => { big._segCache.clear(); checkLayout(big); });
    check(tPortsB / tPortsS < 8, `perf: ports() ${small.pieces.length}→${big.pieces.length} elementów: ${tPortsS.toFixed(2)}→${tPortsB.toFixed(2)} ms (4× elementów, < 8× czasu)`);
    check(tChkB / tChkS < 8, `perf: checkLayout ${tChkS.toFixed(1)}→${tChkB.toFixed(1)} ms (4× elementów, < 8× czasu)`);
    check(tChkB < 500, `perf: checkLayout na ${big.pieces.length} elementach < 500 ms (${tChkB.toFixed(0)} ms)`);
  }

  // ---- poziomy: grupowanie wysokości i filtr (Node) ----
  {
    const L = new Layout();
    const a = L.add('55200', { x: 0, y: 0, rot: 0 });
    const b = L.attach('55200', 0, L.portOf(a, 1));
    const c = L.attach('55200', 0, L.portOf(b, 1));
    L.setHeight(c, 100);                                  // c i wszystko połączone → 100 (cała grupa)
    check(L.levels().length === 1 && L.levels()[0].z === 100, `levels: płaski układ = 1 poziom (${JSON.stringify(L.levels())})`);
    const d = L.add('55200', { x: 0, y: 400, rot: 0 });   // osobny tor na 0
    const e = L.add('55212', { x: 0, y: 800, rot: 0 }); L.setHeight(e, 80); L.setGrade(e, 5);   // rampa 80 → ~91
    const lv = L.levels();
    check(lv.length === 2 && lv[0].z === 0 && lv[1].min === 80 && lv[1].max === 100, `levels: 0 mm i 80–100 mm (rampa łączy się z poziomem 100 przez przerwę < 30 mm) ${JSON.stringify(lv)}`);
    check(Layout.inLevel(a, lv[1]) && !Layout.inLevel(d, lv[1]) && Layout.inLevel(e, lv[1]) && Layout.inLevel(d, lv[0]), 'levels: inLevel – przecięcie zakresu wysokości elementu z poziomem');
    L.setHeight(e, 300);
    check(L.levels().length === 3, 'levels: rampa przeniesiona na 300 mm = trzeci poziom');
    const hitAll = L.hitTest(100, 400, 12), hitFiltered = L.hitTest(100, 400, 12, (p) => Layout.inLevel(p, lv[1]));
    check(hitAll === d && hitFiltered === null, 'levels: hitTest z filtrem pomija elementy spoza poziomu');
  }

  // ---- import listy części: AnyRail / SCARM / arkusz (Node) ----
  {
    const { parsePartList } = await import('../js/partlist.js');
    const anyrail = 'Quantity\tArticle\tDescription\n12\tPIKO 55200\tG239 Straight 239.07 mm\n8\tPIKO 55212\tR2 Curve 421.88 mm / 30°\n2\tPIKO 55220\tWL Left turnout 15°\n';
    const a = parsePartList(anyrail);
    check(JSON.stringify(a.items) === JSON.stringify([{ id: '55200', n: 12 }, { id: '55212', n: 8 }, { id: '55220', n: 2 }]) && a.unknown.length === 0, 'partlist: AnyRail TSV (ilość w pierwszej kolumnie, nagłówek pominięty)');
    const scarm = '55212 | R2 Curve 421.88mm/30° | 8\n55200 | G239 | 3\n55221 | WR | 1\nMärklin 24188 | 188 mm | 4\n';
    const b = parsePartList(scarm);
    check(b.items.find((i) => i.id === '55212').n === 8 && b.items.find((i) => i.id === '55200').n === 3 && b.items.length === 3 && b.unknown.length === 1, 'partlist: SCARM (ilość w ostatniej kolumnie, obcy artykuł → nierozpoznany)');
    const sheet = 'G239;12\nR2, 6 szt.\n4 x 55220\nWL 2 Stk\n55212\n';
    const c = parsePartList(sheet).items;
    check(c.find((i) => i.id === '55200').n === 12 && c.find((i) => i.id === '55212').n === 7 && c.find((i) => i.id === '55220').n === 6, 'partlist: kody geometrii, sufiksy szt./Stk/x, sumowanie duplikatów, brak ilości = 1');
    check(parsePartList('').items.length === 0 && parsePartList('hello world').items.length === 0, 'partlist: pusty/bez numerów → brak pozycji');
    const bed = parsePartList('55400;5').items;
    check(bed.length === 1 && bed[0].id === '55400', 'partlist: numery z podsypką 554xx trafiają do własnego artykułu');
  }

  // ---- offline: lista precache w sw.js pokrywa wszystkie pliki aplikacji (Node, statycznie) ----
  {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]);
    const files = ['index.html', 'manifest.json', ...walk('js'), ...walk('css'), ...walk('icons'), ...walk('vendor').filter((f) => f.endsWith('.js'))];
    const missing = files.filter((f) => !listed.has(f));
    check(missing.length === 0, 'offline: PRECACHE w sw.js zawiera każdy plik aplikacji' + (missing.length ? ' (brak: ' + missing.join(', ') + ')' : ''));
    check(/__SW_VERSION__/.test(sw) && /__SW_VERSION__/.test(fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8')), 'offline: wersja SW wstawiana przy deployu (pages.yml)');
  }

  // ---- struktura UI: pionowe plastry (Node, statycznie) ----
  {
    const uiDir = path.join(ROOT, 'js', 'ui');
    const slices = fs.readdirSync(uiDir).filter((f) => f.endsWith('.js') && f !== 'app.js').sort();
    const mainSrc = fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8');
    check(mainSrc.split('\n').length < 80, 'ui: main.js to tylko orkiestrator (< 80 linii)');
    check(slices.length >= 9 && slices.every((f) => /export function init\(app\)/.test(fs.readFileSync(path.join(uiDir, f), 'utf8'))), 'ui: każdy plaster js/ui/* eksportuje init(app) (' + slices.join(', ') + ')');
    check(slices.every((f) => mainSrc.includes(`./ui/${f}`)), 'ui: main.js importuje każdy plaster');
    const cross = slices.filter((f) => /from ['"]\.\/(?!app\.js)[^'"]+['"]/.test(fs.readFileSync(path.join(uiDir, f), 'utf8')));
    check(cross.length === 0, 'ui: plastry nie importują się nawzajem (tylko ./app.js) ' + (cross.length ? cross.join(',') : ''));
    const versioned = /from ['"]\.{1,2}\/[^'"]+\.js['"]/;
    check(slices.concat(['app.js']).every((f) => versioned.test(fs.readFileSync(path.join(uiDir, f), 'utf8'))), 'ui: importy plastrów pasują do wzorca cache-bustingu w pages.yml');
  }

  // ---- desktop ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  hook(page, 'desktop');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-split.png') });

  const demo = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')));
  check(demo && demo.pieces.length === 18, 'demo: pętla z 18 elementów zapisana w localStorage');
  const hookKeys = ['layout', 'editor', 'view3d', 'insert', 'closeFromCursor', 'problems', 'train', 'setTrainMode', 'buildPrintView', 'removePrintView', 'shoppingList', 'setSystem', 'getSystem', 'encodeShare', 'decodeShare', 'loadFromHash', 'recent'];
  const missing = await page.evaluate((keys) => keys.filter((k) => window.__railsketch[k] === undefined), hookKeys);
  check(missing.length === 0, 'ui: window.__railsketch ma pełne API po podziale na plastry' + (missing.length ? ' (brak: ' + missing.join(',') + ')' : ''));

  // auto-rysowanie: wyczyść, wstaw WL, potem R9 na odgałęzienie – końce muszą się zgadzać z geometrią Piko
  const auto = await page.evaluate(async () => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
    window.confirm = () => true;
    document.getElementById('btn-menu').click();
    document.getElementById('btn-clear').click();
    document.querySelector('#menu [data-close]').click();
    window.__railsketch.insert('55220', 0);                 // WL, kursor -> port 1 (prosto)
    window.__railsketch.insert('55200');                 // G239 za prostą
    const s = JSON.parse(localStorage.getItem('railsketch.v1'));
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
  const boardColor = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).board.color);
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
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')));
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
  const afterUndo = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).pieces.length);
  check(afterUndo === 2, 'undo: przywraca stan sprzed importu (2 elementy)');

  // nowy układ: przycisk czyści wszystko, a po przeładowaniu demo NIE wraca
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); });
  const afterNew = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).pieces.length);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).pieces.length);
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
  const gridOn = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.grid')).enabled);
  check(gridOn, 'rysowanie: siatka pomocnicza zapisana w ustawieniach');
  const box = await page.locator('#canvas2d').boundingBox();
  const sx = box.x + 60, sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(sx + i * 6, sy + Math.sin(i / 2) * 3);
  for (let a = 0; a <= 90; a += 3) { const r = 120; await page.mouse.move(sx + 240 + r * Math.sin(a * Math.PI / 180), sy + r - r * Math.cos(a * Math.PI / 180)); }
  await page.mouse.up();
  // normalizacja na żywo: krzywa z ręki po puszczeniu myszy jest prostą + łukiem (łamana, nie 41 surowych punktów)
  const live = await page.evaluate(() => {
    const st = window.__railsketch.editor.strokes[0];
    // pierwsza część (prosta): wszystkie punkty do ~240 px w prawo leżą na jednej linii
    const [x0, y0] = st[0]; const [x1, y1] = st[1];
    const straightLen = Math.hypot(x1 - x0, y1 - y0);
    return { n: st.length, straightLen, dy: Math.abs(y1 - y0) };
  });
  check(live.n < 30 && live.straightLen > 200 && live.dy < 0.01, `normalizacja na żywo: kreska → prosta ${live.straightLen.toFixed(0)} mm + łuk (${live.n} pkt)`);
  const nStrokes = await page.evaluate(() => window.__railsketch.editor.strokes.length);
  check(nStrokes === 1, 'rysowanie: kreska zarejestrowana');
  await page.click('#btn-finish');
  const fitted = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).pieces);
  check(fitted.length >= 3 && fitted.some((p) => p.id.startsWith('5521')), 'rysowanie: szkic zamieniony na proste i łuki');
  const m1 = await page.evaluate(() => window.__railsketch.lastFit.method);
  check(m1 === 'normalized', 'rysowanie: z „Normalizuj linie” użyta normalizacja');
  // to samo bez poprawiania: tor dosłownie za kreską (metoda zachłanna), ustawienie zapamiętane
  await page.click('#btn-new'); await page.click('#btn-fit2d'); await page.click('#btn-draw');
  await page.uncheck('#chk-fix');
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(sx + i * 6, sy + Math.sin(i / 3) * 4);
  await page.mouse.up();
  await page.click('#btn-finish');
  const m2 = await page.evaluate(() => ({ m: window.__railsketch.lastFit.method, pref: localStorage.getItem('railsketch.fix'), n: window.__railsketch.layout.pieces.length }));
  check(m2.m === 'greedy' && m2.pref === '0' && m2.n > 0, `rysowanie: bez poprawiania metoda zachłanna (${m2.n} el.), ustawienie zapamiętane`);
  await page.click('#btn-draw'); await page.check('#chk-fix'); await page.click('#btn-draw');
  await page.screenshot({ path: path.join(OUT, 'desktop-fitted.png') });

  // sceneria: wstaw drzewo i drogę, zmień rozmiar drogi, sprawdź zapis i 3D
  const scen = await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
    window.__railsketch.insert('conifer');
    window.__railsketch.insert('road');
    set('in-sel-w', 900); set('in-sel-h', 80);
    document.querySelector('#pal-tabs button[data-tab="scenery"]').click();
    const entryHidden = document.getElementById('entry-row').classList.contains('hidden');
    const s = JSON.parse(localStorage.getItem('railsketch.v1'));
    return { entryHidden, scenery: s.scenery, version: s.version, name: document.getElementById('sel-name').textContent };
  });
  check(scen.entryHidden && scen.scenery.length === 2 && scen.scenery[0].type === 'conifer', 'sceneria: drzewo i droga wstawione, zapisane w JSON v' + scen.version);
  check(scen.scenery[1].w === 900 && scen.scenery[1].h === 80, 'sceneria: rozmiar drogi z panelu zaznaczenia (900×80)');
  await page.click('#btn-rot-r');
  const rot = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).scenery[1].rot);
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
    localStorage.setItem('railsketch.v1', JSON.stringify({ version: 2, name: 'Scenery', board: { w: 2000, h: 1000 }, pieces: [], scenery }));
  });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const nTypes = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).scenery.length);
  check(nTypes === 14, 'sceneria: wszystkie 14 typów wstawione i wczytane po przeładowaniu');
  await page.click('#tab-3d'); await page.click('#btn-fit3d'); await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'desktop-scenery-all.png') });
  await page.click('#tab-2d');
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; window.__railsketch.insert('road'); });
  await page.click('#btn-del');
  const afterDel = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).scenery.length);
  check(meshes === 1 && afterDel === 14, 'sceneria: usunięcie zaznaczonego obiektu');
  await page.evaluate(() => document.querySelector('#pal-tabs button[data-tab="piko"]').click());

  // obrotnica w UI: wstaw, stuknij obrzeże, doklej prostą, ustaw nachylenie, 3D
  await page.click('#btn-new');
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; window.__railsketch.insert('TT'); });
  await page.click('#btn-fit2d');
  const ttInfo = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('railsketch.v1')); return s.pieces[0]; });
  // stuknięcie w obrzeże pod kątem 120° tworzy tam port i ustawia kursor
  const rimPx = await page.evaluate((tt) => {
    const { editor } = window.__railsketch; const a = 120 * Math.PI / 180;
    const p = editor.toScreen(tt.x + tt.r * Math.cos(a), tt.y + tt.r * Math.sin(a));
    const r = editor.canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y };
  }, ttInfo);
  await page.mouse.click(rimPx.x, rimPx.y);
  const rimState = await page.evaluate(() => { const { layout, editor } = window.__railsketch; const c = editor.cursorPort(); return { angles: layout.pieces[0].angles, cursorA: c && Math.round(c.a) }; });
  check(rimState.angles.includes(120) && rimState.cursorA === 120, 'obrotnica UI: stuknięcie w obrzeże → port pod 120° i kursor');
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; window.__railsketch.insert('55200'); set('in-sel-g', 4); });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.v1')).pieces);
  check(after.length === 2 && after[1].id === '55200' && after[1].rot === 120 && Math.abs(after[1].dz - 9.5628) < 0.01, 'obrotnica UI: prosta doklejona do portu 120°, nachylenie 4% z panelu');
  await page.click('#tab-3d'); await page.click('#btn-fit3d'); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-turntable-3d.png') });
  await page.click('#tab-2d');

  // chowanie panelu bocznego: canvas 2D rośnie, stan zapamiętany
  await page.click('#tab-2d');
  const wBefore = await page.evaluate(() => document.getElementById('canvas2d').clientWidth);
  await page.click('#btn-side'); await page.waitForTimeout(200);
  const wAfter = await page.evaluate(() => document.getElementById('canvas2d').clientWidth);
  const sideSaved = await page.evaluate(() => localStorage.getItem('railsketch.side'));
  check(wAfter > wBefore + 300 && sideSaved === '1', `panel boczny: schowany, canvas ${wBefore} → ${wAfter} px`);
  await page.click('#btn-side'); await page.waitForTimeout(200);

  // paleta-lista: klik w wiersz wstawia element, przycisk „w prawo” przy łuku daje skręt w drugą stronę
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); document.querySelector('#pal-tabs button[data-tab="piko"]').click(); });
  const rows = await page.evaluate(() => ({ n: document.querySelectorAll('.pal-item').length, sections: [...document.querySelectorAll('.pal-section')].map((e) => e.textContent), icons: document.querySelectorAll('.pal-item svg.pal-icon path').length }));
  check(rows.n >= 28 && rows.sections.length === 5 && rows.icons >= 28, `paleta: ${rows.n} wierszy w ${rows.sections.length} sekcjach, miniatury SVG`);
  await page.click('.pal-item[data-id="55200"]');
  await page.click('.pal-item[data-id="55212"] button[data-entry="1"]');
  const palState = await page.evaluate(() => window.__railsketch.layout.pieces.map((p) => [p.id, Math.round(p.rot)]));
  // R2 portem 1 za prostą (kierunek 0°): rot = 180 − 30 = 150 → łuk skręca w prawo (wyjście pod −30°)
  check(palState.length === 2 && palState[1][0] === '55212' && palState[1][1] === 150, 'paleta: prosta + R2 „w prawo” (wejście portem 1) (' + JSON.stringify(palState) + ')');
  await page.evaluate(() => document.querySelector('#pal-tabs button[data-tab="scenery"]').click());
  await page.click('.pal-item[data-type="house"]');
  const scen1 = await page.evaluate(() => window.__railsketch.layout.scenery.length);
  check(scen1 === 1, 'paleta: zakładka Sceneria wstawia obiekt z listy');
  await page.evaluate(() => document.querySelector('#pal-tabs button[data-tab="piko"]').click());

  // domykanie w UI: owal bez jednej prostej, przycisk „Domknij” przy aktywnym końcu
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); const { insert, editor, layout } = window.__railsketch; const first = insert('55200'); editor.cursor = { uid: first.uid, idx: 1 };
    for (const id of ['55200', '55212', '55212', '55212', '55212', '55212', '55212', '55200', '55200', '55200', '55212', '55212', '55212', '55212', '55212', '55212']) insert(id); void layout; });
  const closeVisible = await page.evaluate(() => !document.getElementById('btn-close').classList.contains('hidden'));
  await page.click('#btn-close'); await page.waitForTimeout(200);
  const closed = await page.evaluate(() => ({ open: window.__railsketch.layout.openPorts().length, n: window.__railsketch.layout.pieces.length, toast: document.getElementById('toast').textContent }));
  check(closeVisible && closed.open === 0 && closed.n === 18, `domykanie UI: przycisk widoczny, owal domknięty (${closed.toast})`);

  // kontrola w UI: krzyżujące się tory → badge na menu, lista w menu, znacznik na planie
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); const { layout } = window.__railsketch; layout.add('55200', { x: 800, y: 500, rot: 0 }); layout.add('55200', { x: 900, y: 400, rot: 90 }); });
  await page.waitForTimeout(400);
  const ui = await page.evaluate(() => ({ badge: document.getElementById('menu-badge').textContent, hidden: document.getElementById('menu-badge').classList.contains('hidden'), n: window.__railsketch.problems().length, markers: window.__railsketch.editor.problems.length }));
  await page.click('#btn-menu');
  const listed = await page.evaluate(() => document.querySelectorAll('#problems .prob').length);
  await page.screenshot({ path: path.join(OUT, 'desktop-problems.png') });
  await page.click('#menu button[data-close]');
  check(ui.badge === '1' && !ui.hidden && ui.n === 1 && ui.markers === 1 && listed === 1, `kontrola UI: badge ${ui.badge}, ${listed} na liście, ${ui.markers} znacznik`);

  // jazda w UI: tryb, start, pozycja się zmienia, stuknięcie rozjazdu przełącza
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); const { insert, editor, layout } = window.__railsketch; const a = insert('55200'); editor.cursor = { uid: a.uid, idx: 1 }; insert('55220'); insert('55200'); editor.cursor = { uid: layout.pieces[1].uid, idx: 2 }; insert('55219'); editor.cursor = { uid: a.uid, idx: 0 }; });
  await page.click('#btn-train');
  const t0 = await page.evaluate(() => ({ mode: window.__railsketch.editor.mode, bar: !document.getElementById('train-bar').classList.contains('hidden'), x: window.__railsketch.train.pose().x }));
  await page.click('#btn-play'); await page.waitForTimeout(600);
  const t1 = await page.evaluate(() => ({ x: window.__railsketch.train.pose().x, running: window.__railsketch.train.running, meshes: window.__railsketch.view3d.trainGroup.children.length }));
  await page.click('#btn-play');
  // stuknij rozjazd (element 2) na planie
  const wlPx = await page.evaluate(() => { const { editor, layout } = window.__railsketch; const wl = layout.pieces[1]; const p = editor.toScreen(wl.x + 120, wl.y); const r = editor.canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; });
  await page.mouse.click(wlPx.x, wlPx.y);
  const sw = await page.evaluate(() => window.__railsketch.layout.pieces[1].sw);
  await page.screenshot({ path: path.join(OUT, 'desktop-train.png') });
  await page.click('#btn-train');
  check(t0.mode === 'train' && t0.bar && t1.x > t0.x + 30 && t1.running && t1.meshes === 3 && sw === 1, `jazda UI: start x ${t0.x.toFixed(0)} → ${t1.x.toFixed(0)}, ${t1.meshes} bryły w 3D, rozjazd przełożony (sw=${sw})`);

  // druk: kafelki 1:1 (2000×1000 → 11×4 = 44 stron A4) i cały plan na jednej stronie
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); const { insert, editor } = window.__railsketch; const a = insert('55200'); editor.cursor = { uid: a.uid, idx: 1 }; for (const id of ['55200', '55212', '55212']) insert(id); });
  const pr = await page.evaluate(() => {
    const { buildPrintView, removePrintView, layout } = window.__railsketch;
    const tiles = buildPrintView(layout, 'tiles', { tile: 'kafelek' });
    const first = tiles.querySelector('canvas');
    const res = { pages: tiles.querySelectorAll('.page').length, cssW: first.style.width, cssH: first.style.height, pxW: first.width, title: tiles.querySelector('.page-title').textContent };
    // piksel toru na pierwszym kafelku: tor zaczyna się na środku widoku → sprawdź, że kafelek zawierający tor ma ciemne piksele szyn
    const p0 = layout.pieces[0]; const col = Math.floor(p0.x / 190), row = Math.floor(p0.y / 277);
    const idx = row * Math.ceil(layout.board.w / 190) + col; const c = tiles.querySelectorAll('canvas')[idx];
    const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 110 && d[i + 1] < 110 && d[i + 2] < 110) dark++;
    res.darkPx = dark;
    removePrintView();
    const one = buildPrintView(layout, 'page', { scale: 'skala' });
    res.onePage = one.querySelectorAll('.page').length; res.oneCss = one.querySelector('canvas').style.width; res.oneTitle = one.querySelector('.page-title').textContent;
    removePrintView();
    res.left = document.querySelectorAll('#print-root').length;
    res.listeners = layout.listeners.size;
    return res;
  });
  check(pr.pages === 44 && pr.cssW === '190mm' && pr.cssH === '277mm' && pr.pxW === 760 && /A1 \/ D11/.test(pr.title), `druk: ${pr.pages} kafelków A4, kanwa ${pr.cssW}×${pr.cssH} (${pr.title})`);
  check(pr.darkPx > 500, `druk: kafelek z torem ma szyny (${pr.darkPx} ciemnych px)`);
  check(pr.onePage === 1 && pr.oneCss === '277mm' && /1:7\.2/.test(pr.oneTitle) && pr.left === 0, `druk: jedna strona, ${pr.oneCss} szerokości, ${pr.oneTitle}`);
  check(pr.listeners < 12, `druk: renderery tymczasowe odpięte od układu (${pr.listeners} listenerów)`);

  // lista zakupów: 2 × G239 w układzie, mam 1 → kupić 1; tekst listy; zapis
  await page.click('#btn-menu');
  await page.fill('#bom input.have[data-id="55200"]', '1');
  await page.dispatchEvent('#bom input.have[data-id="55200"]', 'change');
  const shop = await page.evaluate(() => ({ buy: [...document.querySelectorAll('#bom .buy')].map((e) => e.textContent), toBuy: document.getElementById('to-buy').textContent, list: window.__railsketch.shoppingList(), saved: JSON.parse(localStorage.getItem('railsketch.have'))['55200'] }));
  await page.click('#menu button[data-close]');
  check(shop.buy[0] === '1 ×' && shop.buy[1] === '2 ×' && /2/.test(shop.toBuy) === false && /3/.test(shop.toBuy) && shop.list.startsWith('1 × 55200') && shop.saved === 1, `lista zakupów: ${JSON.stringify(shop.buy)} → "${shop.toBuy}"`);
  await page.evaluate(() => { localStorage.removeItem('railsketch.have'); });

  // system torów w UI: wybór podsypki → lista 554xx, wstawianie, dopasowanie szkicu i domykanie mapują na 554xx
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); document.querySelector('#pal-tabs button[data-tab="piko"]').click(); window.__railsketch.setSystem('piko-a-bed'); });
  const sysRows = await page.evaluate(() => [...new Set([...document.querySelectorAll('.pal-item[data-id]')].map((e) => e.dataset.id))]);
  await page.click('.pal-item[data-id="55400"]');
  await page.click('.pal-item[data-id="55412"] button[data-entry="0"]');
  const sysPieces = await page.evaluate(() => window.__railsketch.layout.pieces.map((p) => p.id));
  // szkic: prosta → elementy 554xx
  await page.click('#btn-draw');
  const bx = await page.locator('#canvas2d').boundingBox();
  await page.mouse.move(bx.x + 60, bx.y + 80); await page.mouse.down(); for (let i = 1; i <= 30; i++) await page.mouse.move(bx.x + 60 + i * 6, bx.y + 80); await page.mouse.up();
  await page.click('#btn-finish'); await page.waitForTimeout(200);
  const sysFit = await page.evaluate(() => window.__railsketch.layout.pieces.slice(2).map((p) => p.id));
  await page.evaluate(() => window.__railsketch.setSystem('piko-a'));
  const backRows = await page.evaluate(() => new Set([...document.querySelectorAll('.pal-item[data-id^="552"]')].map((e) => e.dataset.id)).size);
  check(sysRows.length === 28 && sysRows.every((id) => id.startsWith('554')) && sysPieces.join() === '55400,55412', `system torów: lista ${sysRows.length}×554xx, wstawiono ${sysPieces.join('+')}`);
  check(sysFit.length > 0 && sysFit.every((id) => id.startsWith('554')) && backRows === 28, `system torów: szkic → ${sysFit.join(',')}; powrót do 552xx (${backRows} wierszy)`);

  // ostatnio używane, zaznaczanie prostokątem, wymiary, link
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-new').click(); document.querySelector('#pal-tabs button[data-tab="piko"]').click(); });
  await page.click('.pal-item[data-id="55201"]');
  const rec = await page.evaluate(() => ({ first: document.querySelector('.pal-section').textContent, firstRow: document.querySelector('.pal-item').dataset.id, saved: JSON.parse(localStorage.getItem('railsketch.recent')) }));
  check(rec.first === 'Recently used' && rec.firstRow === '55201' && rec.saved[0] === '55201', `ostatnio używane: sekcja na górze (${rec.firstRow})`);
  // dwa elementy w rzędzie + trzeci daleko; zaznacz prostokątem pierwsze dwa, przesuń grupę przeciągając, obróć, usuń
  await page.evaluate(() => { const { layout, editor } = window.__railsketch; layout.clear(); const a = layout.add('55200', { x: 300, y: 300, rot: 0 }); layout.attach('55200', 0, layout.portOf(a, 1)); layout.add('55200', { x: 300, y: 800, rot: 0 }); editor.view = { scale: 0.5, ox: 60, oy: 60 }; editor.draw(); });
  await page.click('#btn-marquee');
  const q = await page.evaluate(() => { const { editor } = window.__railsketch; const r = editor.canvas.getBoundingClientRect(); const p0 = editor.toScreen(280, 260), p1 = editor.toScreen(900, 340); return { x0: r.left + p0.x, y0: r.top + p0.y, x1: r.left + p1.x, y1: r.top + p1.y, mode: editor.mode }; });
  await page.mouse.move(q.x0, q.y0); await page.mouse.down(); await page.mouse.move(q.x1, q.y1, { steps: 5 }); await page.mouse.up();
  const sel = await page.evaluate(() => ({ n: window.__railsketch.editor.selection.size, mode: window.__railsketch.editor.mode, label: document.getElementById('sel-name').textContent }));
  // przeciągnij grupę za pierwszy element o +200 mm w x
  const g = await page.evaluate(() => { const { editor, layout } = window.__railsketch; const r = editor.canvas.getBoundingClientRect(); const p = editor.toScreen(layout.pieces[0].x + 100, layout.pieces[0].y); const d = editor.toScreen(layout.pieces[0].x + 300, layout.pieces[0].y); return { x: r.left + p.x, y: r.top + p.y, dx: r.left + d.x, dy: r.top + d.y }; });
  await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.dx, g.dy, { steps: 8 }); await page.mouse.up();
  const moved = await page.evaluate(() => window.__railsketch.layout.pieces.map((p) => Math.round(p.x)));
  await page.click('#btn-rot-r');
  const grot = await page.evaluate(() => window.__railsketch.layout.pieces.map((p) => Math.round(p.rot)));
  await page.click('#btn-del');
  const left = await page.evaluate(() => window.__railsketch.layout.pieces.length);
  check(q.mode === 'marquee' && sel.n === 2 && sel.mode === 'edit' && /2/.test(sel.label), `zaznaczanie: prostokąt → ${sel.n} elementy, etykieta „${sel.label}”`);
  check(moved[0] === 500 && moved[1] === 739 && moved[2] === 300, `zaznaczanie: przeciągnięcie grupy (${moved.join(',')})`);
  check(grot[0] === 15 && grot[1] === 15 && grot[2] === 0 && left === 1, `zaznaczanie: obrót grupy (${grot.join(',')}) i usunięcie (zostało ${left})`);
  // wymiary
  await page.evaluate(() => { const { layout } = window.__railsketch; layout.clear(); layout.add('55200', { x: 300, y: 300, rot: 0 }); layout.add('55200', { x: 300, y: 361.88, rot: 0 }); layout.add('55212', { x: 800, y: 300, rot: 0 }); });
  await page.click('#btn-dims'); await page.waitForTimeout(100);
  const dimsOn = await page.evaluate(() => ({ on: window.__railsketch.editor.dims, pref: localStorage.getItem('railsketch.dims'), active: document.getElementById('btn-dims').classList.contains('active') }));
  await page.screenshot({ path: path.join(OUT, 'desktop-dims.png') });
  await page.click('#btn-dims');
  check(dimsOn.on && dimsOn.pref === '1' && dimsOn.active, 'wymiary: tryb włączony i zapamiętany');
  // link: koduj → dekoduj; nawigacja z #L= wczytuje układ
  const share = await page.evaluate(async () => { const { encodeShare, decodeShare, layout } = window.__railsketch; const frag = await encodeShare(layout.toJSON()); const back = await decodeShare('#' + frag); return { frag: frag.slice(0, 2), len: frag.length, pieces: back.pieces.length, url: location.origin + location.pathname + '#' + frag }; });
  await page.goto(share.url, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const fromLink = await page.evaluate(() => ({ n: window.__railsketch.layout.pieces.length, hash: location.hash, ids: window.__railsketch.layout.pieces.map((p) => p.id).join() }));
  check(share.frag === 'L=' && share.len < 400 && share.pieces === 3 && fromLink.n === 3 && fromLink.hash === '' && fromLink.ids === '55200,55200,55212', `link: ${share.len} znaków, wczytany z adresu (${fromLink.ids}), hash wyczyszczony`);

  // i18n: przełączenie na DE zmienia teksty UI i nazwy w katalogu
  const de = await page.evaluate(() => {
    window.__railsketch.recent.length = 0; localStorage.removeItem('railsketch.recent');
    const sel = document.getElementById('sel-lang'); sel.value = 'de'; sel.dispatchEvent(new Event('change'));
    document.querySelector('#pal-tabs button[data-tab="piko"]').click();
    return { tab: document.querySelector('#pal-tabs button[data-tab="piko"]').textContent, group: document.querySelector('.pal-section').textContent,
      piece: document.querySelector('.pal-item .pal-desc').textContent, lang: document.documentElement.lang };
  });
  check(de.lang === 'de' && de.tab.includes('PIKO') && de.group === 'Gerade Gleise' && de.piece.includes('Gerades Gleis'), 'i18n: przełączenie na DE tłumaczy UI i katalog');
  const pl = await page.evaluate(() => { const sel = document.getElementById('sel-lang'); sel.value = 'pl'; sel.dispatchEvent(new Event('change')); return document.querySelector('#pal-tabs button[data-tab="scenery"]').textContent; });
  check(pl.includes('Sceneria'), 'i18n: powrót do PL');

  // ---- tabor w menu: zmiana obrysu uruchamia kontrolę ----
  {
    await page.evaluate(() => { const { layout, editor } = window.__railsketch; editor.cursor = null; editor.selected = null; layout.clear(); layout.add('55211', { x: 800, y: 600, rot: 0 }); localStorage.removeItem('railsketch.stock'); });
    await page.click('#btn-menu'); await page.waitForTimeout(200);
    const opts = await page.locator('#sel-stock option').count();
    await page.selectOption('#sel-stock', 'long'); await page.waitForTimeout(300);
    const types = await page.evaluate(() => window.__railsketch.problems().map((p) => p.type));
    check(opts === 3 && types.includes('radius'), `stock UI: wybór długiego taboru → problem „promień” dla R1 (${types.join(',')})`);
    await page.selectOption('#sel-stock', 'standard'); await page.waitForTimeout(300);
    const types2 = await page.evaluate(() => window.__railsketch.problems().map((p) => p.type));
    check(!types2.includes('radius') && (await page.evaluate(() => localStorage.getItem('railsketch.stock'))) === 'standard', 'stock UI: powrót do standardowego taboru czyści problem i zapisuje preferencję');
    await page.click('#menu [data-close]'); await page.waitForTimeout(100);
    await page.evaluate(() => { window.__railsketch.layout.clear(); });
  }

  // ---- poziomy w 2D: pasek, wybór poziomu, wyszarzenie i blokada stuknięcia ----
  {
    await page.evaluate(() => { const { layout, editor } = window.__railsketch; window.confirm = () => true; editor.cursor = null; editor.selected = null; layout.clear();
      const a = layout.add('55200', { x: 300, y: 300, rot: 0 }); const b = layout.add('55200', { x: 300, y: 600, rot: 0 }); layout.setHeight(b, 120); editor.view = { ox: 0, oy: 0, scale: 1 }; editor.draw(); });
    await page.waitForTimeout(150);
    const cnt = await page.locator('#levels-count').textContent();
    check(cnt === '2', `levels UI: licznik poziomów na przycisku HUD = 2 („${cnt}”)`);
    await page.click('#btn-levels'); await page.waitForTimeout(100);
    const opts = await page.locator('#sel-level option').allTextContents();
    check(!(await page.locator('#levels-bar').isHidden()) && opts.length === 3, `levels UI: pasek z opcjami ${JSON.stringify(opts)}`);
    await page.selectOption('#sel-level', '120'); await page.waitForTimeout(150);
    const lvl = await page.evaluate(() => window.__railsketch.editor.level);
    check(lvl && lvl.min === 120 && lvl.max === 120, `levels UI: wybór poziomu ustawia filtr edytora ${JSON.stringify(lvl)}`);
    // stuknięcie w tor na poziomie 0 nie zaznacza go; stuknięcie w tor na 120 – tak
    const box = await page.locator('#canvas2d').boundingBox();
    await page.mouse.click(box.x + 420, box.y + 300); await page.waitForTimeout(120);
    const sel0 = await page.evaluate(() => window.__railsketch.editor.selected && window.__railsketch.editor.selected.z);
    await page.mouse.click(box.x + 420, box.y + 600); await page.waitForTimeout(120);
    const sel120 = await page.evaluate(() => window.__railsketch.editor.selected && window.__railsketch.editor.selected.z);
    check((sel0 === null || sel0 === undefined) && sel120 === 120, `levels UI: element spoza poziomu jest nieaktywny (sel0=${sel0}, sel120=${sel120})`);
    // wyszarzony ślad: piksel na osi toru 0 mm jest jaśniejszy/mniej nasycony niż na torze 120 mm
    const px = await page.evaluate(() => { const c = document.getElementById('canvas2d'); const g = c.getContext('2d'); const r = devicePixelRatio || 1; const at = (x, y) => [...g.getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data]; return { off: at(420, 300), on: at(420, 600) }; });
    check(JSON.stringify(px.off) !== JSON.stringify(px.on), `levels UI: tor spoza poziomu rysowany inaczej (${px.off} vs ${px.on})`);
    await page.click('#btn-levels'); await page.waitForTimeout(100);
    const cleared = await page.evaluate(() => window.__railsketch.editor.level === null);
    check(cleared && await page.locator('#levels-bar').isHidden(), 'levels UI: zamknięcie paska zdejmuje filtr');
    await page.evaluate(() => { const { layout } = window.__railsketch; layout.clear(); });
  }

  // ---- import listy części przez menu: plik → kolumna „mam” ----
  {
    await page.click('#btn-menu'); await page.waitForTimeout(200);
    await page.setInputFiles('#file-import-parts', { name: 'parts.csv', mimeType: 'text/csv', buffer: Buffer.from('Quantity;Article;Description\n3;PIKO 55200;G239\n2;55212;R2\n') });
    await page.waitForTimeout(300);
    const have = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#bom input.have')].map((i) => [i.dataset.id, +i.value])));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('railsketch.have') || '{}'));
    check(stored['55200'] === 3 && stored['55212'] === 2, `partlist UI: import ustawia „mam” i zapisuje w prefs (${JSON.stringify(stored)})`);
    check(have['55200'] === 3 || have['55200'] === undefined, 'partlist UI: wartości w tabeli BOM odpowiadają prefs');
    const toastText = await page.locator('#toast').textContent();
    check(/2/.test(toastText) && /5/.test(toastText), `partlist UI: toast podsumowuje import („${toastText}”)`);
    await page.evaluate(() => { localStorage.removeItem('railsketch.have'); });
    await page.click('#menu [data-close]'); await page.waitForTimeout(100);
  }

  // ---- offline: service worker zapisuje aplikację i uruchamia ją bez sieci ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const off = await ctx.newPage();
    hook(off, 'offline');
    await off.goto(url, { waitUntil: 'networkidle' });
    const swState = await off.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 100; i++) {
        const keys = await caches.keys();
        const c = keys.length ? await caches.open(keys[0]) : null;
        const have = c ? (await c.keys()).length : 0;
        if (have >= 30) return { keys, have, hasMain: !!(await c.match('js/main.js')), hasIndex: !!(await c.match('index.html')) };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { keys: await caches.keys(), have: 0 };
    });
    check(swState.keys.some((k) => k.startsWith('railsketch-')) && swState.hasMain && swState.hasIndex, `offline: cache "${swState.keys[0]}" zawiera ${swState.have} plików`);
    const exposed = await off.evaluate(() => window.__railsketch.offline && window.__railsketch.offline.supported);
    check(exposed === true, 'offline: plaster ui/offline.js wystawia stan');
    await ctx.setOffline(true);
    let booted = false, offlinePieces = 0;
    try {
      await off.goto(url, { waitUntil: 'load' });
      await off.waitForFunction(() => window.__railsketch && window.__railsketch.layout, null, { timeout: 8000 });
      booted = true; offlinePieces = await off.evaluate(() => window.__railsketch.layout.pieces.length);
    } catch (e) { console.log('   offline boot:', e.message.split('\n')[0]); }
    check(booted && offlinePieces === 18, `offline: strona wczytana bez sieci, demo z ${offlinePieces} elementów`);
    const canvas3d = await off.evaluate(() => !!document.querySelector('#view3d canvas, canvas.three, #c3d') || document.querySelectorAll('canvas').length >= 2);
    check(canvas3d, 'offline: three.js z cache – dwa canvasy (2D + 3D)');
    await ctx.setOffline(false);
    await ctx.close();
  }

  // ---- migracja zapisu ze starej nazwy (RouteLayout → RailSketch) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    await pg.goto(url, { waitUntil: 'networkidle' });
    await pg.evaluate(() => { localStorage.clear(); const p = { id: '55200', x: 100, y: 100, rot: 0 }; localStorage.setItem('routelayout.v1', JSON.stringify({ version: 2, name: 'Stary', board: { w: 1500, h: 900 }, pieces: [{ ...p, uid: 1 }, { ...p, uid: 2, x: 339.07 }], scenery: [] })); localStorage.setItem('routelayout.lang', 'de'); });
    await pg.goto(url, { waitUntil: 'networkidle' }); await pg.waitForTimeout(500);
    const mig = await pg.evaluate(() => ({ n: window.__railsketch.layout.pieces.length, name: window.__railsketch.layout.name, v1: !!localStorage.getItem('railsketch.v1'), lang: localStorage.getItem('railsketch.lang'), old: !!localStorage.getItem('routelayout.v1') }));
    check(mig.n === 2 && mig.name === 'Stary' && mig.v1 && mig.lang === 'de' && mig.old, `migracja: układ i preferencje z routelayout.* skopiowane do railsketch.* (${JSON.stringify(mig)})`);
    await ctx.close();
  }

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
