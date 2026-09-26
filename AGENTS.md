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
| `js/catalog.js` | PIKO A-Gleis catalog with **generated geometry** (`straight`, `curve`, `turnout`, `curvedTurnout`, `threeWay`, `wye`, `crossing`, `doubleSlip`), the turntable (`TT`, dynamic geometry), `geoOf(piece)`, `sampleSegment`. |
| `js/layout.js` | The model: pieces, scenery, board, ports/connections, snapping, undo/redo, heights, turntable rim ports, JSON (de)serialisation, autosave. |
| `js/editor2d.js` | Canvas 2D editor: pan/zoom/pinch, drag, select, cursor (active open end), sketch mode, rendering. |
| `js/fitter.js` | Sketch → pieces. `prepareStroke`, greedy fitter (`fitGreedy`), normalised pipeline (`fitNormalized`), `fitStrokes` (entry), `normalizeStroke` (live, on pointer-up), turnout placement, attachment to open ends. |
| `js/normalize.js` | Stroke → primitives (line/arc): curvature segmentation, circle/line fits, boundary refinement at the tangent point, wobble collapsing, snapping to the PIKO grid, `idealPath`, DP decomposition of straights, `chain`. |
| `js/scenery.js` | Scenery catalog (trees, buildings, roads, pond, hill…): 2D drawing + procedural 3D builders. `bumpGeometry` (hill / pond bowl). |
| `js/view3d.js` | three.js scene: baseboard (top plate with pond holes), rails/sleepers/ballast ribbons following heights, piers, turntable pit, scenery. Renders on demand. |
| `js/main.js` | UI wiring: palette, selection bar, menu, sketch bar, language, side panel, toasts. Exposes `window.__routelayout = { layout, editor, view3d, insert }` for tests and the console. |
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

- Palette: three tabs (PIKO A / Accessories / Scenery); rows are built from the catalog with thumbnails generated from the geometry (`pieceIcon`) or drawn with the 2D scenery painter. Tapping a row inserts; curves have left/right buttons. Adding another track brand = new catalog entries (+ a `brand` field and a tab), no UI work.
- The "cursor" (orange dot) is the active open port; `editor.addPiece(id, entry)` attaches there or, without a cursor, places the piece at the view centre. Tapping a blue dot moves the cursor; tapping a turntable rim creates a rim port there.
- Selection bar shows different fields per selection: track piece → height / grade; turntable → diameter / height; scenery → length / width.
- Errors are never silent: `window.error`, `unhandledrejection` and the custom `routelayout:error` event show a red toast (iPad has no console). `layout.emit` isolates listeners so a WebGL failure cannot abort an edit.
- Preferences live in `localStorage` under `routelayout.*` (`v1` = the layout itself, `lang`, `mode`, `grid`, `fix`, `side`, `tab`). Layout-specific settings (board colour) go into the layout JSON instead.

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

- Sketch fitting does not close loops: a drawn oval leaves a small gap where the discrete pieces do not meet. Closing needs a constrained choice of the last 2–3 pieces.
- Only WL/WR turnouts are inferred from sketches (curved turnouts, DKW, Y are not).
- Heights have no clearance check (a track 30 mm above another is accepted; H0 needs ~55–60 mm).
- The turntable is generic (`TT`, adjustable ⌀), not a PIKO article; the bill of materials lists it as `TT`.
- Article number 55215 (R1 7.5°) is flagged `verified: false` in the catalog.
- No service worker; offline use relies on browser cache only.
