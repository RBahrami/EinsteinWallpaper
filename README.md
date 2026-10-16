# Einstein Wallpaper — Geometric Wallpaper Studio 🎩

Generate wallpapers from the **Einstein tile** (the aperiodic "hat" monotile discovered
in 2023 by David Smith, Joseph Samuel Myers, C. S. Kaplan and Chaim Goodman-Strauss) —
**plus 13 more mathematically verified tiling families** — with custom palettes,
gradient editors, visual effects and animations. Every image can be exported as a
full-resolution **PNG**, a **looping animated GIF** (encoded in the browser, plays
anywhere without extra software), or recorded as a **WebM video** for live
wallpapers on Windows or Android.

![screenshot](docs/screenshot.png)

## Features

### Tiling families (14)
| Family | Variants | Notes |
|--------|----------|-------|
| **Einstein hat** | A / B / C (H, P, F roots) | True aperiodic monotile via the metatile substitution construction from *An Aperiodic Monotile* (arXiv:2303.10798). Unchanged since v1. |
| **Lines** | horizontal, vertical, diagonal 45°, crosshatch, grid | Line-based patterns (strokes, not fake tiles) |
| **Triangles** | equilateral grid, right-triangle grid | Edge-to-edge, alternating rows |
| **Squares** | aligned grid, diamond (45°), checkerboard | |
| **Rectangles** | aligned 2:1 grid, running bond, herringbone 90°, basketweave | Herringbone lattice is verified overlap-free |
| **Rhombi** | 60°/45°/30° acute angles | Affine image of the square grid |
| **Parallelograms** | slant 30° right, 45° right, 30° left | Sheared grid |
| **Hexagons** | flat-top, pointy-top honeycomb | Regular, edge-to-edge |
| **Trapezoids** | flat / standard / steep | Half-turn tessellation of a generic quadrilateral |
| **Kites** | slim / classic / wide | Half-turn tessellation |
| **Trihexagonal** | kagome, rotated 30° | Rectified honeycomb: hexagons + triangles |
| **Octagon–square** | truncated square tiling | Regular octagons + 45° squares |
| **Cairo pentagons** | dual of the snub square tiling | The classic Cairo mosaic pentagon (3 right-angle-free 120°s + two 90°s) |
| **Penrose rhombs** | P3 standard, P3 golden shifts | Dual of a de Bruijn pentagrid; matching rules hold by construction; fat:thin → φ |

Every family's geometry is verified by `tests/verify-tilings.js` (no overlaps, no
holes, correct edge lengths, Penrose fat:thin ratio → φ, Cairo pentagon shape, etc.).

### Color
- **6 color modes** for the hat (Supertiles, By orientation, Mirror split,
  Gradient sweep, Random mix, Solid) and family-appropriate modes for every other
  tiling (By tile kind, By orientation, Gradient sweep, Random mix, Solid).
- **26 curated built-in palettes** (unchanged from v1) — from Midnight and Nord to
  Cyberpunk and Sakura, light and dark.
- **Custom palette editor** — create, rename, duplicate and delete palettes; edit
  colors with native pickers or hex values; add/remove/reorder colors; set the
  background and outline colors (with the automatic outline feature); live preview.
- **Gradient editor** — multi-stop gradients with per-stop color and position,
  linear / radial / conic types, angle control, live preview; use gradients to
  color the tiling (continuous sampling, not discrete cycling) and/or as the
  background. Built-in gradients included.
- **Theme import/export** — custom palettes + gradients as a validated JSON file.

### Visual effects
Blur, Glow (intensity + radius), Shadow/depth (strength + softness + offset),
film Grain, and Vignette (darken or lighten edges). All default to neutral/off,
all are applied identically to the live preview, exported PNGs and recorded WebM
videos, and all work with every tiling family.

### Animation
- **None** (static — no frames rendered),
- **Shimmer** (soft light wave over the tiles),
- **Gradient Flow** (a repeating band of palette/gradient colors drifts across the
  pattern; direction + speed configurable, seamlessly looping),
- **Glow Wave** (a restrained band of brightness sweeps the canvas; seamless loop).

The removed v1 animations (Cascade, Drift, Hue cycle, Pulse) are gone.

### Canvas & export
- Aspect presets 16:9, 16:10, 4:3, 5:4, 3:2, 21:9, 32:9, 1:1 and phone portraits
  (9:16, 9:19.5, 9:20) with standard resolutions from 720p to 4K+, plus custom
  sizes up to 8192 px.
- Tile scale, rotation, tile gap, outline width/color, seeded randomization.
- Full-resolution **PNG export**, looping **animated GIF export** (encoded entirely
  in the browser — no libraries, no external software needed to play it), and
  **WebM recording** (MediaRecorder), all including every effect and animation.
  GIF captures exactly one seamless animation loop (the encoder solves frame
  delay × count against the true loop period), uses one global 256-color
  palette with error-diffusion dithering, long edge capped at 800 px to keep
  files manageable. WebM stays the compact/high-quality option; GIF plays
  anywhere with zero codec requirements.
- Tile budgets keep previews responsive; oversized requests are coarsened
  automatically with a status note.

### Persistence
Settings (family, variant, colors, effects, animation…) persist in `localStorage`
with safe migration from v1 saves (legacy numeric palette indexes keep working).
Custom palettes live in `ew-custom-palettes-v1`, gradients in `ew-gradients-v1`,
both with stable IDs and defensive parsing.

## Quick start

Option A — GitHub Pages (recommended):

1. Repo → *Settings* → *Pages* → deploy from branch `main`, folder `/ (root)`.
2. Open `https://rbahrami.github.io/EinsteinWallpaper/`.

Option B — locally: just open `index.html` in any modern browser (double-click it).
No build step, no server, no dependencies.

### Generate a wallpaper

1. Pick a **tiling family** and **pattern variant**.
2. Choose colors: palette or gradient, color mode, background.
3. Optionally add visual effects and an animation.
4. Click **⬇ PNG (full res)** for a still, or **⏺ Record WebM** for a live wallpaper.

### Live wallpapers

| Platform | How |
|----------|-----|
| **Windows** | [Lively Wallpaper](https://www.rocksdanister.com/lively) (free, open source): *Add Wallpaper* → paste this page's URL to run the interactive web version, or drag in the exported `.webm` as a video wallpaper. Wallpaper Engine also works. |
| **Android** | Use any "video live wallpaper" app and pick the exported `.webm` (convert with `ffmpeg -i in.webm out.mp4` if needed). |
| **Any OS** | Set the page as your browser's startup/new-tab page. |

## Project layout

```
index.html            UI (sidebar + live preview canvas)
css/style.css         dark minimal theme
js/hat-tiling.js      Einstein hat metatile engine (browser & Node, unchanged)
js/tilings.js         13 periodic/composite tiling generators + family metadata + icons
js/render.js          scene building, coloring/LUT, drawing, animations
js/palettes.js        built-in palette library + color helpers
js/gradients.js       multi-stop gradient engine + persistence
js/custom-palettes.js custom palette store + theme import/export
js/effects.js         post-processing pipeline (blur/glow/shadow/grain/vignette)
js/gif.js             dependency-free animated GIF89a encoder (median-cut
                      palette, Floyd-Steinberg dithering, LZW, loop extension)
js/app.js             UI wiring, settings + migration
tests/                geometry + unit verification (see below)
```

## Verification

```bash
# geometry: every family/variant must tile without overlaps or holes,
# with per-family invariants (edge lengths, Penrose phi ratio, Cairo pentagons...)
bun tests/verify-tilings.js        # or: node tests/verify-tilings.js

# gradient engine unit tests (interpolation, clamping, validation, CRUD)
bun tests/test-gradients.js

# custom palette store tests (CRUD, import/export validation, migration)
bun tests/test-palettes.js

# GIF encoder tests (structure walk + LZW round-trip via an independent decoder)
bun tests/test-gif.js
```

`scripts/qa_studio.py` (development machine only; needs Playwright) drives the real
UI in headless Chromium: loads the app, renders every family, edits palettes and
gradients, applies effects, checks animation frames, and exercises PNG/GIF/WebM
export.

## Credits

- Mathematical construction: D. Smith, J. S. Myers, C. S. Kaplan, C. Goodman-Strauss,
  *"An Aperiodic Monotile"*, arXiv:2303.10798 (2023) — https://cs.uwaterloo.ca/~csk/hat/
- Penrose rhombs generated as the dual of a de Bruijn pentagrid
  (N. G. de Bruijn, *Algebraic theory of Penrose's non-periodic tilings*, 1981).
- Cairo pentagonal tiling constructed as the dual of the snub square tiling.
- Inspired by the Quanta Magazine coverage of the 2023 discovery.

## License

MIT — see [LICENSE](LICENSE).
