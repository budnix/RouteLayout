# RouteLayout — planer makiet H0 na torach PIKO A-Gleis

Aplikacja webowa (HTML5, ES modules, Canvas 2D + three.js) do projektowania układów torów w skali H0 z podglądem 3D. Działa w Safari na iPadzie i iPhonie (dotyk, pinch-zoom, tryb „dodaj do ekranu głównego”) oraz na desktopie.

## Uruchomienie

To jest strona statyczna — nie ma builda ani zależności do instalowania. Wystarczy serwer HTTP (moduły ES nie ładują się z `file://`):

```sh
npx serve .           # albo: python3 -m http.server 8080
```

i otwórz `http://localhost:8080`. Na GitHub Pages wystarczy wskazać gałąź z tym katalogiem.

## Jak się rysuje

1. Wybierz grupę i element PIKO z listy (albo użyj szybkich przycisków) i naciśnij **Wstaw**.
2. Pomarańczowa kropka ze strzałką to **aktywny koniec** toru. Kolejny wstawiony element doklei się do niego z właściwym kątem — to jest auto-rysowanie.
3. Stuknij dowolną niebieską kropkę (otwarty koniec), aby przenieść tam aktywny koniec — np. na odgałęzienie rozjazdu.
4. „Wejście portem” wybiera, którym końcem nowy element wchodzi do aktywnego końca (łuk portem 1 = skręt w drugą stronę; rozjazd portem 2 = wjazd od strony odgałęzienia).
5. Elementy można przeciągać palcem/myszą; gdy końce zbliżą się do siebie, dociągają się (snap). Obracanie: przyciski ⟲ ⟳ lub klawisz `R`.
6. Przełącznik **2D / 3D / 2D+3D** w pasku górnym. W 3D: jeden palec obraca, dwa palce przybliżają i przesuwają.
7. Menu ☰: nazwa, rozmiar blatu, eksport/import JSON, zapis PNG, zestawienie części (BOM).

Układ zapisuje się automatycznie w przeglądarce (localStorage).

Skróty: `Ctrl/Cmd+Z` cofnij, `Ctrl/Cmd+Shift+Z` / `Ctrl+Y` ponów, `Delete` usuń, `R` / `Shift+R` obrót, `Enter` wstaw.

## Katalog torów

`js/catalog.js` zawiera wszystkie elementy PIKO A-Gleis H0 (seria 552xx, bez podsypki) z geometrią wg prospektu PIKO:

| Nr | Kod | Opis |
|---|---|---|
| 55200 | G239 | prosta 239,07 mm |
| 55201 | G231 | prosta 230,93 mm |
| 55202 | G119 | prosta 119,54 mm |
| 55203 | G115 | prosta 115,46 mm |
| 55204 | G107 | prosta 107,32 mm |
| 55205 | G62 | prosta 61,88 mm |
| 55206 | G31 | prosta 30,94 mm |
| 55207 / 55208 | ÜG | przejściówki 62 mm |
| 55209 | G940 | flex 940 mm |
| 55211–55214 | R1–R4 | łuki 30°, r = 360 / 421,88 / 483,75 / 545,63 mm |
| 55215* / 55218 | R1 7,5° / R2 7,5° | krótkie łuki |
| 55219 | R9 | przeciwłuk 15°, r = 907,97 mm |
| 55220 / 55221 | WL / WR | rozjazd lewy / prawy 15°, R9, 239 mm |
| 55222 / 55223 | BWL / BWR | rozjazd łukowy R2/R3 |
| 55227 / 55228 | BWL-R3 / BWR-R3 | rozjazd łukowy R3/R4 |
| 55224 | DKW | rozjazd krzyżowy podwójny 15° |
| 55225 | W3 | rozjazd trójdrogowy |
| 55226 | WY | rozjazd Y |
| 55240 / 55241 | K15 / K30 | krzyżownice 15° / 30° |
| 55280 | — | kozioł oporowy |

`*` numer katalogowy do potwierdzenia (geometria poprawna).

Rozjazdy łukowe są modelowane jako dwa łuki o wspólnym początku (jak w bibliotekach AnyRail/SCARM); PIKO zaleca po nich wstawkę G62.

## Struktura

- `js/catalog.js` — dane i generator geometrii (odcinki: linia/łuk, porty z kierunkiem)
- `js/layout.js` — model układu: transformacje, wykrywanie połączeń, snap, undo/redo, JSON, BOM
- `js/editor2d.js` — edytor Canvas 2D z Pointer Events
- `js/view3d.js` — podgląd three.js (szyny, podkłady, podsypka, blat), render on-demand
- `js/main.js` — UI
- `vendor/` — three.js (MIT) skopiowane z npm, bez CDN

## Testy i CI

```sh
npm ci
npx playwright install chromium
npm test            # test dymny w headless Chromium, zrzuty w test-results/
```

- `.github/workflows/test.yml` — uruchamia testy przy każdym pushu i PR.
- `.github/workflows/pages.yml` — po pushu do `main` uruchamia testy i publikuje stronę na GitHub Pages (w ustawieniach repo: Pages → Source → **GitHub Actions**).

## Format pliku

```json
{ "version": 1, "name": "Makieta", "board": { "w": 2000, "h": 1000 },
  "pieces": [ { "id": "55200", "x": 300, "y": 250, "rot": 0 } ] }
```

`x, y` w mm (początek elementu = port 0), `rot` w stopniach.
