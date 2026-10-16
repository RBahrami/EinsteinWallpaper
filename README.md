# Einstein Wallpaper — Geometric Wallpaper Studio 🎩

Generate wallpapers from the **Einstein tile** (the aperiodic "hat" monotile discovered
in 2023 by David Smith, Joseph Samuel Myers, C. S. Kaplan and Chaim Goodman-Strauss) —
**plus 13 more mathematically verified tiling families** — with a unified color theme
system, visual effects and animations. Every image can be exported as a full-resolution
**PNG**, a **looping animated GIF**, or a **lossless APNG** (pixel-perfect animated
PNG) — all encoded entirely in the browser and playable anywhere with no extra
software, plugins or codecs.

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

### Color — one unified Color theme section

A single **Color theme** panel with four modes; only the options that belong to
the selected mode are shown:

| Mode | Options |
|------|---------|
| **Single** | one tile color + background color |
| **Palette** | arrangement (how colors spread across tiles) + the 26 built-in palettes + your custom palettes + background (from palette or custom color) |
| **Gradient** | arrangement (continuous **Sweep**, quantized **Bands**, or **Random mix**) + gradient picker + background (solid color or the gradient itself) |
| **Duotone** | two colors A/B + arrangement (checkerboard / sweep / random) + background color |

The **arrangement** is family-aware: the hat offers Supertiles (patches), By
orientation, Mirror split, Checkerboard and Random mix; periodic families offer
By tile kind, By orientation, Checkerboard and Random mix.

- **26 curated built-in palettes** — from Midnight and Nord to Cyberpunk and
  Sakura, light and dark.
- **Custom palette editor** — create, rename, duplicate and delete palettes; edit
  colors with native pickers or hex values; add/remove/reorder colors; set the
  background and outline colors (with the automatic outline feature); live preview.
- **Gradient editor** — multi-stop gradients with per-stop color and position,
  linear / radial / conic types, angle control, live preview; the gradient
  selected in the theme section colors the tiling (continuous sampling) and/or
  the background. Built-in gradients included.
- **Theme import/export** — custom palettes + gradients as a validated JSON file.
- Every color change re-colors the live preview instantly (no scene rebuild).

### Visual effects
Blur, Glow (intensity + radius), Shadow/depth (strength + softness + offset),
film Grain, and Vignette (darken or lighten edges). All default to neutral/off,
all are applied identically to the live preview and to every export format, and
all work with every tiling family.

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
- **All exports render at the exact canvas resolution you chose** — animated
  exports rebuild the scene at that resolution (1:1, same geometry math as the
  preview) and capture exactly one seamless animation loop (the exporter solves
  frame delay × count against the true loop period).
- **PNG** — full-resolution still, lossless.
- **GIF (looping)** — encoded entirely in the browser from the GIF89a spec:
  one global 256-color palette (median-cut across sample frames, so no palette
  flicker) with Floyd–Steinberg error-diffusion dithering, hand-written LZW,
  NETSCAPE2.0 infinite-loop extension. Plays on literally anything.
- **APNG (lossless)** — animated PNG written from the PNG/APNG spec: truecolor
  RGBA with adaptive per-row PNG filtering (None/Sub/Up/Average/Paeth) and
  DEFLATE (native CompressionStream, with a hand-written zlib stored-blocks
  fallback). **Pixel-perfect**: decoded frames match the rendered canvas
  exactly — verified byte-for-byte in QA. Plays in all modern browsers, macOS
  previews, Telegram/Discord, and most image viewers.
- Tile budgets keep previews responsive; oversized requests are coarsened
  automatically with a status note.

### Persistence
Settings (family, variant, color theme, effects, animation…) persist in
`localStorage` with safe migration from older saves (legacy color modes and
numeric palette indexes keep working). Custom palettes live in
`ew-custom-palettes-v1`, gradients in `ew-gradients-v1`, both with stable IDs
and defensive parsing.

## Quick start

Option A — GitHub Pages (recommended):

1. Repo → *Settings* → *Pages* → deploy from branch `main`, folder `/ (root)`.
2. Open `https://rbahrami.github.io/EinsteinWallpaper/`.

Option B — locally: just open `index.html` in any modern browser (double-click it).
No build step, no server, no dependencies.

### Generate a wallpaper

1. Pick a **tiling family** and **pattern variant**.
2. Open **Color theme** and pick a mode — Single, Palette, Gradient or Duotone —
   only that mode's options are shown.
3. Optionally add visual effects and an animation.
4. Click **⬇ PNG** for a still, or **GIF (looping)** / **APNG (lossless)** for a
   live wallpaper at the chosen canvas resolution.

### Live wallpapers

| Platform | How |
|----------|-----|
| **Windows** | [Lively Wallpaper](https://www.rocksdanister.com/lively) (free, open source): *Add Wallpaper* → paste this page's URL to run the interactive web version, or drag in the exported GIF/APNG as a video wallpaper. Wallpaper Engine also works. |
| **Android** | Set the exported GIF/APNG with any “video live wallpaper” app, or use Wallpaper Engine. |
| **macOS** | APNG animates right in Finder/Preview; animated wallpaper tools accept GIF/APNG directly. |
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
js/apng.js            dependency-free lossless APNG encoder (CRC32 chunks,
                      adaptive PNG filtering, DEFLATE + stored fallback)
js/app.js             UI wiring, color theme system, settings + migration
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

# APNG encoder tests (chunk/CRC walk, filter round-trip, lossless verification)
bun tests/test-apng.js

# color theme system tests (map modes, LUT builders, duotone, bands)
bun tests/test-theme.js
```

`scripts/qa_studio.py` (development machine only; needs Playwright) drives the real
UI in headless Chromium: loads the app, renders every family, switches color theme
modes, edits palettes and gradients, applies effects, checks animation frames, and
exercises PNG/GIF/APNG export at the chosen canvas resolution. `scripts/qa_apng.py`
additionally proves the APNG export is pixel-perfect by comparing the decoded file
byte-for-byte against an in-page reference render.

## Credits

- Mathematical construction: D. Smith, J. S. Myers, C. S. Kaplan, C. Goodman-Strauss,
  *"An Aperiodic Monotile"*, arXiv:2303.10798 (2023) — https://cs.uwaterloo.ca/~csk/hat/
- Penrose rhombs generated as the dual of a de Bruijn pentagrid
  (N. G. de Bruijn, *Algebraic theory of Penrose's non-periodic tilings*, 1981).
- Cairo pentagonal tiling constructed as the dual of the snub square tiling.
- Inspired by the Quanta Magazine coverage of the 2023 discovery.

## License

MIT — see [LICENSE](LICENSE).
