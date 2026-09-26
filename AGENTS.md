# AGENTS.md — knowledge base for AI coding agents working on RouteLayout

RouteLayout is a static web app for planning H0 model-railway layouts on PIKO A-Gleis track with a 3D preview. Live: https://budnix.github.io/RouteLayout/ . This file explains how the code is organised, the conventions that are not obvious from reading it, and the traps previous agents fell into. Read it before changing anything.

## Keeping this file true

**Whenever you change a rule, a convention, a threshold or a trap described here, update the corresponding paragraph in the same commit.** A knowledge file that lags behind the code is worse than none: the next agent will "fix" behaviour that is deliberate, or trust a trap that no longer exists. Concretely:

- New constant in `normalize.js` / `fitter.js` (`MIN_SWEEP`, `R_MIN_REAL`, tolerances…) → its line in *Sketch mode and the normaliser*.
- New `localStorage` key, JSON field or format version → *UI conventions* / *Geometry and coordinate conventions*.
- New module or workflow → *Repository map* / *CI / deployment*.
- A test that caught a non-obvious failure → add the lesson to *Testing → Traps*.
- A limitation removed or added → *Known limitations*.

Reviewers: a PR that changes any of the above without touching `AGENTS.md` is incomplete.

## Hard constraints (do not break)

- **Static site, no build step, no bundler, no framework.** ES modules loaded straight from `index.html`. Anyone must be able to `python3 -m http.server` and run it.
- **No CDN, no runtime network.** three.js is vendored in `vendor/` (copied from npm; `three.module.js` imports `./three.core.js`; `OrbitControls.js` imports bare `three`, resolved by the import map in `index.html`). Do not add `<script src="https://…">`.
- **Must work in Safari on iPad and iPhone** (touch, Pointer Events, pinch, safe-area insets, "Add to Home Screen"). Every UI change is checked at 390 px width.
- **All icons are inline SVG** from the sprite at the top of `index.html` (`<symbol id="i-…">`, used as `<svg class="ic"><use href="#i-…"/></svg>`). Never use Unicode glyphs (⟲ ☰ 🗑 …) as icons — they render differently per device.
- **Everything the user sees is translated** through `js/i18n.js` (PL / EN / DE). Static markup uses `data-i18n` / `data-i18n-title`; JS uses `t(key, params)`. Catalog and scenery names are `{ pl, en, de }` objects. German uses PIKO's own terms (Gerades Gleis, Bogenweiche, DKW, Prellbock…).
- **Geometry stays exact.** PIKO numbers (239.07, 421.88, 907.97, 61.88 …) come from the PIKO brochure; do not "round for convenience".

## Repository map

| Path | What it is |
|---|---|
| `index.html` | Markup, SVG sprite, import map. Palette = tabs (`#pal-tabs`) + list (`#pal-list`). |
| `css/app.css` | Mobile-first; ≥900 px puts the palette in a side panel. Colour tokens on `:root`, dark mode via `prefers-color-scheme`. |
| `js/catalog.js` | PIKO A-Gleis catalog with **generated geometry** and track **systems** (`SYSTEMS`, `toSystem`): 552xx = `piko-a`, generated 554xx mirrors = `piko-a-bed` (same `geo` object, `base` = 552xx id, unverified except 55418), turntable = `common`. Algorithms (fitter, closer) always produce base 552xx ids; the UI maps them to the selected system with `toCurrentSystem` at insertion time. Adding a brand = entries with a new `system` key (and a `SYSTEMS` entry); the palette lists whatever the catalog contains (`straight`, `curve`, `turnout`, `curvedTurnout`, `threeWay`, `wye`, `crossing`, `doubleSlip`), the turntable (`TT`, dynamic geometry), `geoOf(piece)`, `sampleSegment`. |
| `js/layout.js` | The model: pieces, scenery, board, ports/connections, snapping, undo/redo, heights, turntable rim ports, JSON (de)serialisation, autosave. |
| `js/editor2d.js` | Canvas 2D editor: pan/zoom/pinch, drag, select, cursor (active open end), sketch mode, rendering. |
| `js/fitter.js` | Sketch → pieces. `prepareStroke`, greedy fitter (`fitGreedy`), normalised pipeline (`fitNormalized`), `fitStrokes` (entry), `normalizeStroke` (live, on pointer-up), turnout placement, attachment to open ends. |
| `js/normalize.js` | Stroke → primitives (line/arc): curvature segmentation, circle/line fits, boundary refinement at the tangent point, wobble collapsing, snapping to the PIKO grid, `idealPath`, DP decomposition of straights, `chain`. |
| `js/closer.js` | Loop closing: `closeGap(portA, portB)` searches 1–4 catalog pieces (straights + curves both ways) whose chain from A lands on B within 1.5 mm / 1.5°; exactness is a hard priority, piece count and "small pieces" only break ties; otherwise reports the best miss ("7.3 mm off"). `pickPartner` chooses the open end facing the cursor. Used by the HUD link button and `autoClose` after a sketch. |
| `js/checks.js` | Feasibility checks (`checkLayout`): grade > 3.5 %, clearance < 55 mm between crossing tracks on different levels, same-level collision (axes intersect, pieces not directly connected), axis spacing < 45 mm, track outside/within 20 mm of the board edge. Runs debounced after every change; results show as markers on the plan, a list in the menu and a badge on the menu button. Constants at the top of the file. Two pieces that both connect to the same neighbour (turnout legs) are not reported for spacing near that joint. |
| `js/train.js` | Test-run simulation: `Train` moves along piece routes (`routes` from the catalog, `[[0,1]]` by default; the route index equals the segment index, orientation fixed by which end is nearer port `a`), passes through mated ports, picks the route at a turnout from `piece.sw` (cycled by `toggleSwitch`, persisted in JSON), stops at a dead end, `reverse()` swaps entry/exit. Wagons follow a distance-indexed trail seeded straight backwards on placement. UI in `js/ui/trainmode.js` (`setTrainMode`, rAF loop only while running); 2D draws the active route of every turnout in green. |
| `js/print.js` | Printing: `buildPrintView(layout, 'tiles'|'page')` renders the plan with throw-away `Editor2D` instances onto canvases whose CSS size is in mm (190×277 mm per A4 tile at 1:1, or one landscape page scaled to fit); `printLayout` adds `#print-root`, calls `window.print()` and cleans up on `afterprint`. Each temporary editor must be `dispose()`d (it subscribes to the layout in its constructor). Print CSS at the end of `app.css`. |
| `js/share.js` | Share links: the whole layout JSON deflate-raw-compressed (`CompressionStream`) and base64url-encoded into `#L=…` (`#J=…` uncompressed fallback for browsers without CompressionStream). `js/ui/menu.js` loads it on start and on `hashchange`, then clears the hash. |
| `js/scenery.js` | Scenery catalog (trees, buildings, roads, pond, hill…): 2D drawing + procedural 3D builders. `bumpGeometry` (hill / pond bowl). |
| `js/view3d.js` | three.js scene: baseboard (top plate with pond holes), rails/sleepers/ballast ribbons following heights, piers, turntable pit, scenery. Renders on demand. |
| `js/main.js` | Orchestrator only (~40 lines): `createApp()`, `slice.init(app)` for every `js/ui/*` slice in a fixed order, then start-up (autosave hook, `Layout.loadSaved` or the demo oval, `loadFromHash`, fit, mode, `runChecks`). No UI logic lives here. |
| `js/ui/app.js` | Shared UI context: `$`, `prefs` (`get/set/getJSON/setJSON` under `routelayout.*`), `toast`, `errMsg`, `createApp()` (Layout + Editor2D + View3D, global error toasts, `window.__routelayout = { layout, editor, view3d }`, `app.expose(obj)` merges into that hook). |
| `js/ui/palette.js` | Palette slice: track-system select, tabs, "Recently used", `buildList`/`pieceRow`/`sceneryRow`, entry select, palette grip. Sets `app.insert`, `app.buildList`, `app.fillEntry`, `app.fillSystems`, `app.toCurrentSystem`, `app.getSystem/setSystem`. |
| `js/ui/topbar.js` | View mode (`app.setMode`: 2d/split/3d), new/undo/redo/fit/zoom, side-panel collapse. |
| `js/ui/sketch.js` | Sketch bar: grid + grid-size prefs, "Normalise lines" pref, `app.setDrawMode`, `app.finishDrawing` (fits strokes, maps to the current system, `app.autoClose`, stores `lastFit`). |
| `js/ui/problems.js` | Feasibility checks UI: debounced `app.runChecks`, `app.renderProblems`, markers/badge, `centerOn`. |
| `js/ui/tools.js` | Marquee toggle and dimension mode (`setDims`). |
| `js/ui/trainmode.js` | Test run: `Train` instance, rAF loop only while running, `app.setTrainMode`, play/reverse/speed, switch toggling. |
| `js/ui/closing.js` | Loop closing: `app.closeFromCursor` (HUD button) and `app.autoClose(added)` after a sketch. |
| `js/ui/selection.js` | Selection bar fields per selection type and global keyboard shortcuts. |
| `js/ui/menu.js` | Menu: name, board size/colour, clear, export/import/PNG, share link + `app.loadFromHash`, print, language (`applyLanguage`), BOM with shopping list (`have` pref). Provides `app.closeMenu`, `app.refreshMenu`. |
| `tests/smoke.test.cjs` | The whole test suite (Node model tests + Playwright browser tests). `npm test`. |
| `.github/workflows/test.yml` | Runs `npm test` on every push/PR. |
| `.github/workflows/pages.yml` | `workflow_run` after a green Test on `main`: cache-busts module URLs (`?v=<sha>`), deploys to GitHub Pages. |
| `.claude/settings.json` | Disables Claude attribution in commits/PRs (`includeCoAuthoredBy: false`, empty `attribution`). Respect it. |

## Geometry and coordinate conventions

- Units: **millimetres** everywhere; angles in **degrees**. `norm(a)` maps to (−180, 180].
- World frame = screen frame of the 2D canvas: **x right, y down**. Angles increase clockwise on screen (mathematically positive in the y-down frame). 3D maps world `(x, y)` → three.js `(x, z)`, height → `y`.
- A catalog piece is defined in its local frame: **port 0 at (0,0)**, the track enters along +X. Each port has `{x, y, a}` where `a` is the *outward* heading (port 0 has `a = 180`).
- A curve turns "left" (dir +1, centre at (0, r)) when entered via port 0; entering via **port 1 turns it the other way**. There are no separate left/right curve articles.
- Piece instance: `{ uid, id, x, y, rot, z, dz }`. `(x, y, rot)` places the local origin; `z` is the height at port 0; `dz` the rise from port 0 to the other ports (turnouts: same `dz` on all exits). Turntable instances add `{ r, bridge, angles }` and their origin is the **centre** (`rot` stays 0; rotating rotates the bridge).
- `Layout.poseFor(id, entry, targetPort)` gives the pose that puts port `entry` on `targetPort` with opposite heading. `Layout.worldPort(piece, idx)` returns `{x, y, a, z, piece, idx}`.
- Two ports are **connected** when within 0.6 mm, headings opposite within 1°, and heights within 3 mm. Connections are recomputed from geometry (`layout.ports()`, cached until the next `emit`); there is no explicit link graph. `openPorts()` are the unmatched ones.
- Heights: `setHeight(piece, z)` shifts the whole connected group; `setGrade(piece, pct)` sets `dz` and raises everything reachable from the piece's exits. `attach()` inherits the grade of the piece it continues from.
- Scenery item: `{ uid, type, x, y, rot, w, h }`, centre-based; `w` along local X. Ponds cut real holes in the 3D board plate.
- JSON file format is version 2 (`pieces`, `scenery`, `board { w, h, color }`); version 1 files still load. Keep loading backwards compatible when you change it.

## Sketch mode and the normaliser (the subtle part)

Flow: pointer strokes → (if "Normalise lines" is on) `normalizeStroke` replaces each stroke on pointer-up with the polyline of its ideal path → *Finish drawing* runs `fitStrokes(strokes, layout, { normalize })` → `layout.addMany(pieces)` as one undo step.

`fitNormalized` per stroke: `prepareStroke` (resample 5 mm, smooth, tangents) → `segment` (primitives) → `idealPath` (snapped straights/arcs from a start pose) → straights decomposed by DP into the fewest standard pieces (`decomposeStraight`, penalty per piece; higher at free ends), arcs into `n ×` the catalog piece of that radius → turnouts inserted where another stroke branches off (`straightWithTurnouts` scans the toe position; the branch stroke then starts from the *actual* branch port) → `chain`.

The normaliser reasons from the palette — these rules are deliberate and tested, keep them:
- Radii snap to R1–R4/R9 (`snapRadius`, log-distance); arc angles snap to the grid available for that radius (7.5° for R1/R2, 30° for R3/R4, 15° for R9); the free start heading snaps to 15°.
- An arc sweeping < 9° is a straight (`MIN_SWEEP`; R9 15° measures ~12° after smoothing, so do not raise this).
- An arc tighter than 80 % of R1 (`R_MIN_REAL`) cannot be built: if short (< 45°) and the straights before/after are parallel it is hand jitter → straight; if the direction change persists it is intent → R1; if long (≥ 45°) it is "as tight as possible" → R1 (`dropUnbuildable`).
- Alternating arcs whose points stay within 25 mm of the **neighbouring straight's extension** collapse into that straight (`collapseWobble`). Without a neighbouring straight, ≥ 3 alternations are required, so an isolated S-curve of two arcs survives. Measuring against a freshly fitted line instead of the neighbour was a bug: it swallowed the standard R9/R9 parallel shift (62 mm).
- Line/arc boundaries are refined to the **tangent point** (foot of the perpendicular from the circle centre onto the line); residual-based refinement misses the start of an arc by 50–70 mm because an arc leaves a line as s²/2r.
- The arc angle between two straights is the difference of their headings; otherwise it comes from the fitted circle's radius vectors (works past 180°).
- `fitStrokes` falls back to the greedy fitter only when the normalised result deviates badly (mean > 40 mm or max > 110 mm); with `normalize: false` it is greedy directly.

When you touch these rules, run the "brzeg" (edge-case) tests — every one of them was added because it caught a real regression.

## UI conventions

- **Vertical slices.** `js/main.js` only wires things together; every feature area is a module in `js/ui/` exporting `init(app)`. A slice binds its DOM, subscribes to `layout`/`editor` events and publishes the functions other slices need by assigning them on `app` (`app.setDrawMode = …`). Cross-slice calls go through `app.*` (optional-chained when the other slice may not be loaded yet, e.g. `app.closeMenu?.()`), never through imports between slices. Init order in `main.js` matters only for calls made *during* init; the order is palette, topbar, sketch, problems, tools, trainmode, closing, selection, menu. Anything tests or the console need goes through `app.expose({...})`, which merges into `window.__routelayout`; keep that API stable (`layout, editor, view3d, insert, closeFromCursor, problems(), train, setTrainMode, buildPrintView, removePrintView, shoppingList, setSystem, getSystem, encodeShare, decodeShare, loadFromHash, recent, lastFit`). A new feature = a new slice file + one line in `main.js` + its row in this map.
- Palette: three tabs (PIKO A / Accessories / Scenery); rows are built from the catalog with thumbnails generated from the geometry (`pieceIcon`) or drawn with the 2D scenery painter. Tapping a row inserts; curves have left/right buttons. Adding another track brand = new catalog entries (+ a `brand` field and a tab), no UI work.
- Group selection: the marquee HUD button switches the editor to mode `marquee`; the drag rectangle selects every track piece with an axis point inside (`layout.piecesInRect`) into `editor.selection` (a Set), then the mode returns to `edit`. Dragging any selected piece moves the whole group (`layout.moveMany`, one undo step, no snapping); rotate buttons rotate the group around its centroid (`rotateMany`, turntables turn their bridge); delete removes all (`removeMany`). Selections that reference removed pieces are dropped on every `change`.
- Dimension mode (`editor.dims`, ruler HUD button, persisted) draws straight lengths, curve radii/angles, spacing between parallel straights (40–250 mm apart, overlap > 50 mm) and the board size.
- The palette shows a "Recently used" section (last 6 inserted ids/types, `routelayout.recent`) rebuilt after every insert while keeping the list scroll position.
- The "cursor" (orange dot) is the active open port; `editor.addPiece(id, entry)` attaches there or, without a cursor, places the piece at the view centre. Tapping a blue dot moves the cursor; tapping a turntable rim creates a rim port there.
- Selection bar shows different fields per selection: track piece → height / grade; turntable → diameter / height; scenery → length / width.
- Errors are never silent: `window.error`, `unhandledrejection` and the custom `routelayout:error` event show a red toast (iPad has no console). `layout.emit` isolates listeners so a WebGL failure cannot abort an edit.
- Preferences live in `localStorage` under `routelayout.*` (`v1` = the layout itself, `lang`, `mode`, `grid`, `fix`, `side`, `tab`, `system` = selected track system, `have` = owned pieces per article for the shopping list, `recent`, `dims`). Layout-specific settings (board colour) go into the layout JSON instead.

## Testing

```sh
npm ci
npx playwright install chromium     # CI uses --with-deps
npm test                            # tests/smoke.test.cjs; screenshots in test-results/
```

- One file, two halves: Node-only model/algorithm tests first (import `../js/*.js` dynamically), then Playwright: desktop 1280×800 and a 390×844 touch viewport. `check(cond, label)` collects failures; the process exits 1 if any.
- Headless Chromium runs WebGL via SwiftShader (`--use-gl=swiftshader`); "GL Driver Message … ReadPixels" warnings are noise and filtered.
- Insert pieces in browser tests through `window.__routelayout.insert(id, entry)` / `insert(type)`, not by poking DOM controls.
- Traps that cost time before:
  - `confirm()` dialogs: Playwright auto-dismisses them (returns false). Override `window.confirm = () => true` before clicking *New layout* / *Clear*.
  - Setting layout state through `localStorage` between UI actions does not work — every change autosaves and overwrites it. Build the JSON completely, write it once, then `page.reload()`.
  - Reading WebGL pixels with `readPixels` returns zeros (no `preserveDrawingBuffer`); take an element screenshot and read the pixel from a 2D canvas instead.
  - A `position: fixed` element with a CSS `transform` is reported "not stable" by Playwright and never gets clicked. Use `top: calc(50% - Npx)` instead of `translateY(-50%)`.
  - `[a, b].map(prepareStroke)` passes the index as `step` (→ `step = 0` → infinite loop). Always wrap: `.map((s) => prepareStroke(s))`. `prepareStroke` now guards `step <= 0`, but the pattern is still wrong.
  - `grep -E "FAIL|przeszły"` exits 0 when it matches the summary line even if tests failed — do not chain `&& git commit` after such a grep. Check the exit code of `npm test` itself.

## CI / deployment

- Push to `main` → `Test` workflow → on success `Deploy to GitHub Pages` (`workflow_run`). A red Test blocks the deploy; `concurrency` cancels superseded deploys.
- The deploy step rewrites every relative module import and the CSS/JS URLs in `index.html` to `…?v=<short sha>` (GitHub Pages sends `max-age=600` and Safari happily mixes a fresh `index.html` with a stale module). Bare `three` imports go through the import map, which is rewritten too.
- Pages source must be "GitHub Actions" in the repository settings.

## Git conventions

- Work directly on `main` (owner's decision); one focused commit per change; imperative English subject.
- **No Claude/AI attribution** in commit messages or PR bodies (`.claude/settings.json`); do not add `Co-Authored-By` or session trailers. Commits are authored as the repository owner.
- Run `npm test` before every push. Never push with a red suite "to fix later" — the deploy pipeline is gated on it, but the red run still costs a cycle.

## Known limitations / natural next steps

- Loop closing (`closer.js`) tries up to 4 pieces; gaps needing more (or a curve rearrangement) report the best miss and leave it to the user.
- Only WL/WR turnouts are inferred from sketches (curved turnouts, DKW, Y are not).
- The clearance check uses the axis distance only (no rolling-stock envelope); 55 mm is a rule of thumb for H0 double-deck stock.
- The turntable is generic (`TT`, adjustable ⌀), not a PIKO article; the bill of materials lists it as `TT`.
- Article number 55215 (R1 7.5°) is flagged `verified: false` in the catalog.
- No service worker; offline use relies on browser cache only.
