# RouteLayout — H0 track planner for PIKO A-Gleis with 3D preview

**Live app: https://budnix.github.io/RouteLayout/**

A web app (HTML5, ES modules, Canvas 2D + three.js) for designing H0 model railway layouts with a real-time 3D preview. Runs in Safari on iPad and iPhone (touch, pinch-zoom, "Add to Home Screen") as well as on desktop browsers. No build step, no backend, no account — your layout is saved in the browser.

![RouteLayout on desktop: 2D editor next to the 3D preview](docs/screenshot-desktop.png)

## Features

- Complete **PIKO A-Gleis H0** catalog (552xx series) with exact geometry: straights, curves R1–R4 / R9, 7.5° curves, standard, curved, three-way and Y turnouts, double slip, crossings, flex track, buffer stop
- **Auto-drawing**: pick a piece, tap *Insert* — it snaps onto the active open track end at the correct angle. Tap any open end (e.g. a turnout branch) to continue from there
- Drag pieces with a finger or mouse; nearby track ends snap together
- **3D preview** with rails (16.5 mm gauge), sleepers, ballast, baseboard and shadows — rendered on demand to save battery
- Undo/redo, autosave, JSON import/export, PNG export, bill of materials with article numbers
- Configurable baseboard size, dark mode, PWA manifest

## Running locally

It's a static site. Any HTTP server will do (ES modules don't load from `file://`):

```sh
npx serve .           # or: python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## How to draw

1. Choose a group and a PIKO piece from the list (or use the quick buttons) and press **Insert**.
2. The orange dot with an arrow is the **active track end**. The next inserted piece attaches there with the right angle.
3. Tap any blue dot (open end) to move the active end there — e.g. onto a turnout's branch.
4. **Entry port** selects which end of the new piece connects to the active end (a curve via port 1 turns the other way; a turnout via port 2 is entered from its branch).
5. Drag pieces to move them; ends close to each other snap. Rotate with ⟲ ⟳ or the `R` key.
6. Switch **2D / 3D / 2D+3D** in the top bar. In 3D: one finger orbits, two fingers zoom and pan.
7. Menu ☰: layout name, baseboard size, JSON export/import, PNG export, bill of materials.

Keyboard: `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` / `Ctrl+Y` redo, `Delete` remove, `R` / `Shift+R` rotate, `Enter` insert.

## Track catalog

`js/catalog.js` contains every PIKO A-Gleis H0 element (552xx series, without roadbed) with geometry from the PIKO brochure (470 mm module, 61.88 mm parallel track spacing):

| No. | Code | Description |
|---|---|---|
| 55200 | G239 | straight 239.07 mm |
| 55201 | G231 | straight 230.93 mm |
| 55202 | G119 | straight 119.54 mm |
| 55203 | G115 | straight 115.46 mm |
| 55204 | G107 | straight 107.32 mm |
| 55205 | G62 | straight 61.88 mm |
| 55206 | G31 | straight 30.94 mm |
| 55207 / 55208 | ÜG | transition tracks 62 mm |
| 55209 | G940 | flex track 940 mm |
| 55211–55214 | R1–R4 | curves 30°, r = 360 / 421.88 / 483.75 / 545.63 mm |
| 55215* / 55218 | R1 7.5° / R2 7.5° | short curves |
| 55219 | R9 | counter-curve 15°, r = 907.97 mm |
| 55220 / 55221 | WL / WR | left / right turnout 15°, R9, 239 mm |
| 55222 / 55223 | BWL / BWR | curved turnout R2/R3 |
| 55227 / 55228 | BWL-R3 / BWR-R3 | curved turnout R3/R4 |
| 55224 | DKW | double slip 15° |
| 55225 | W3 | three-way turnout |
| 55226 | WY | Y turnout |
| 55240 / 55241 | K15 / K30 | crossings 15° / 30° |
| 55280 | — | buffer stop |

`*` article number to be confirmed (geometry is correct).

Curved turnouts are modelled as two arcs sharing a start point (as in AnyRail/SCARM libraries); PIKO recommends a G62 filler after them.

Other track systems (Roco, Tillig, Märklin C, Peco…) can be added by extending `js/catalog.js` — every piece is just a list of line/arc segments plus connection ports.

## Project structure

- `js/catalog.js` — catalog data and geometry generator (segments: line/arc, ports with heading)
- `js/layout.js` — layout model: transforms, connection detection, snapping, undo/redo, JSON, BOM
- `js/editor2d.js` — Canvas 2D editor using Pointer Events
- `js/view3d.js` — three.js preview (rails, sleepers, ballast, baseboard), on-demand rendering
- `js/main.js` — UI wiring
- `vendor/` — three.js (MIT) copied from npm, no CDN

## Tests and CI

```sh
npm ci
npx playwright install chromium
npm test            # smoke test in headless Chromium, screenshots in test-results/
```

- `.github/workflows/test.yml` — runs the tests on every push and pull request.
- `.github/workflows/pages.yml` — after a green `Test` run on `main`, deploys that commit to GitHub Pages (repo setting: Pages → Source → **GitHub Actions**).

## File format

```json
{ "version": 1, "name": "Layout", "board": { "w": 2000, "h": 1000 },
  "pieces": [ { "id": "55200", "x": 300, "y": 250, "rot": 0 } ] }
```

`x, y` in mm (piece origin = port 0), `rot` in degrees.

## Contributing

Issues and pull requests are welcome — especially geometry corrections, new track systems and iOS quirks.

## License

MIT. three.js is © its authors, MIT licensed (see `vendor/THREE-LICENSE`).
