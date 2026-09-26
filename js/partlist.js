// Import listy części z innych planerów (AnyRail, SCARM, arkusz) do listy zakupów („mam”).
// Nie zakładamy jednego formatu: każda linia jest skanowana pod kątem numeru artykułu PIKO
// (55xxx z katalogu) albo kodu geometrii (G239, R2, WL, BWL…) oraz ilości.
//
// Rozpoznawane przykłady:
//   AnyRail (parts list, TSV/CSV):  "12\tPIKO 55200\tG239 Straight 239 mm"
//   SCARM (parts list, TXT):        "55212 | R2 Curve 421.88mm/30° | 8"   lub  "8 x 55212"
//   Arkusz:                         "55220;WL;3"  /  "G239, 12"
// Wynik: { items: [{ id, n }], unknown: [line] } – ilość domyślnie 1, gdy w linii jest tylko artykuł.

import { BY_ID, CATALOG } from './catalog.js';

const CODE_BY_TEXT = new Map();
for (const p of CATALOG) if (p.code && p.system !== 'piko-a-bed') CODE_BY_TEXT.set(p.code.toUpperCase(), p.id);
const QTY_WORDS = /(?:^|[\s,;|])(\d{1,3})\s*(?:x|×|pcs?|szt\.?|stk\.?|st\.?)?(?=$|[\s,;|])/gi;
const HEADER = /\b(qty|quantity|count|anzahl|menge|ilość|ilosc|liczba|article|artikel|artykuł|code|kod|description|opis|beschreibung|name|nazwa)\b/i;

export function parsePartList(text) {
  const items = new Map(), unknown = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADER.test(line) && !/\b55\d{3}\b/.test(line)) continue;   // nagłówek kolumn
    const id = findArticle(line);
    if (!id) { if (/\d/.test(line)) unknown.push(line); continue; }
    const n = findQuantity(line, id);
    items.set(id, (items.get(id) || 0) + n);
  }
  return { items: [...items.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => a.id.localeCompare(b.id)), unknown };
}

/** Numer artykułu PIKO (dowolny system) albo kod geometrii jako osobne słowo. */
function findArticle(line) {
  for (const m of line.matchAll(/\b(55\d{3})\b/g)) if (BY_ID[m[1]]) return m[1];
  for (const tok of line.toUpperCase().split(/[^A-Z0-9]+/)) { const id = CODE_BY_TEXT.get(tok); if (id) return id; }
  return null;
}

/** Ilość: liczba 1–999 nie będąca numerem artykułu ani częścią wymiaru (239,07 / 30°); w razie kilku – z sufiksem x/szt/Stk, inaczej ostatnia lub pierwsza kolumna. */
function findQuantity(line, id) {
  const cleaned = line.replace(new RegExp(`\\b${id}\\b`), ' ').replace(/\d+[.,]\d+/g, ' ').replace(/\d+\s*(?:mm|°|deg|cm|m)\b/gi, ' ').replace(/\bR\d\b|\bG\d+\b|\bW\d+\b/gi, ' ');
  const found = [...cleaned.matchAll(QTY_WORDS)];
  if (!found.length) return 1;
  const withUnit = found.find((m) => /(x|×|pcs?|szt|stk|st)\.?\s*$/i.test(m[0].trim()) || /^\d{1,3}\s*(x|×)/i.test(m[0].trim()));
  const pick = withUnit || (found.length > 1 && /^\d/.test(line) ? found[0] : found[found.length - 1]);
  return Math.max(1, Math.min(999, +pick[1] || 1));
}
