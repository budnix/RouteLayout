// Druk planu: kafelki A4 w skali 1:1 (do rozłożenia na blacie) albo cały plan
// na jednej stronie. Rysuje planem z Editor2D na kanwach w rozmiarze mm
// (CSS), więc przeglądarka drukuje w skali; na iPadzie: Udostępnij → Drukuj →
// rozsuń podgląd → zapis do PDF.

import { Editor2D } from './editor2d.js';

export const A4 = { w: 190, h: 277 };   // obszar zadruku A4 pion przy marginesie 10 mm [mm]
const PX_PER_MM = 4;                    // rozdzielczość kanwy (4 px/mm ≈ 100 dpi)

/** Renderuje fragment planu (mm) na kanwę o rozmiarze CSS w mm. */
function renderRegion(layout, x0, y0, wmm, hmm, scale = 1) {
  const canvas = document.createElement('canvas');
  const px = PX_PER_MM;
  const holder = document.createElement('div'); holder.append(canvas);
  const r = new Editor2D(canvas, layout);
  // konstruktor wywołuje resize() wg rozmiaru rodzica (0) – rozmiar ustawiamy dopiero teraz i blokujemy dalsze zmiany
  r.resize = () => {}; r.dpr = 1;
  canvas.width = Math.round(wmm * px); canvas.height = Math.round(hmm * px);
  canvas.style.width = `${wmm}mm`; canvas.style.height = `${hmm}mm`;
  r.view = { scale: px * scale, ox: -x0 * px * scale, oy: -y0 * px * scale };
  r.draw();
  r.dispose();
  return canvas;
}

/**
 * Buduje widok do druku i zwraca jego korzeń (dodany do <body>).
 * mode: 'tiles' (1:1, kafelki A4) | 'page' (cały plan na jednej stronie A4 poziomo).
 */
export function buildPrintView(layout, mode = 'tiles', labels = {}) {
  removePrintView();
  const root = document.createElement('div');
  root.id = 'print-root';
  const { w, h } = layout.board;
  const name = layout.name || 'Layout';
  if (mode === 'page') {
    const scale = Math.min(A4.h / w, A4.w / h);     // strona pozioma: 277 × 190
    const page = document.createElement('section'); page.className = 'page landscape';
    page.innerHTML = `<div class="page-title">${esc(name)} — ${labels.scale || 'scale'} 1:${(1 / scale).toFixed(1)} · ${w} × ${h} mm</div>`;
    page.append(renderRegion(layout, 0, 0, w * scale, h * scale, scale));
    root.append(page);
  } else {
    const cols = Math.ceil(w / A4.w), rows = Math.ceil(h / A4.h);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x0 = i * A4.w, y0 = j * A4.h;
      const page = document.createElement('section'); page.className = 'page';
      const tw = Math.min(A4.w, w - x0), th = Math.min(A4.h, h - y0);
      page.innerHTML = `<div class="page-title">${esc(name)} — ${labels.tile || 'tile'} ${String.fromCharCode(65 + j)}${i + 1} / ${String.fromCharCode(65 + rows - 1)}${cols} · x ${x0}–${x0 + tw} mm · y ${y0}–${y0 + th} mm · 1:1</div>`;
      page.append(renderRegion(layout, x0, y0, tw, th, 1));
      root.append(page);
    }
  }
  document.body.append(root);
  return root;
}

export function removePrintView() { document.getElementById('print-root')?.remove(); }

/** Otwiera dialog drukowania z przygotowanym widokiem; sprząta po zamknięciu. */
export function printLayout(layout, mode, labels) {
  buildPrintView(layout, mode, labels);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); removePrintView(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
