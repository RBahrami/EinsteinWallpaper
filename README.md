# Einstein Wallpaper — Hat Tile Studio 🎩

Generate wallpapers from the **Einstein tile** (the aperiodic "hat" monotile discovered
in 2023 by David Smith, Joseph Samuel Myers, C. S. Kaplan and Chaim Goodman-Strauss).
Every image is a patch of a tiling that **never repeats** — and every wallpaper can be
animated and exported for use as a live wallpaper on Windows or Android.

![screenshot](docs/screenshot.png)

## Features

- **True aperiodic tiling** — renders the hat tile via the metatile substitution
  construction from the paper *An Aperiodic Monotile* (arXiv:2303.10798). No image
  assets: every tile is computed geometrically.
- **Any size & ratio** — presets for 16:9, 16:10, 4:3, 5:4, 3:2, 21:9, 32:9, 1:1 and
  phone portrait ratios (9:16, 9:19.5, 9:20) with standard resolutions from 720p to 4K+,
  plus fully custom width × height (up to 8192 px).
- **Scale control** — set the hat edge size in pixels; the app automatically picks the
  substitution depth so the canvas is always completely covered.
- **6 color modes** — Supertiles, By orientation, Mirror split, Gradient sweep,
  Random mix, Solid.
- **26 curated palettes** — from Midnight and Nord to Cyberpunk and Sakura (light & dark).
- **Adjustable look** — rotation (15° steps), gap between tiles, outline width/color,
  pattern variants, random seed.
- **Live wallpaper animations** — Shimmer, Cascade, Drift, Hue cycle, Pulse, with speed
  control and a live preview.
- **Export** — full-resolution PNG, or record the animation to a **WebM video** for
  wallpaper engines.
- **Zero dependencies** — plain HTML/CSS/JS. Works offline from a local file.

## Quick start

Option A — GitHub Pages (recommended):

1. Repo → *Settings* → *Pages* → deploy from branch `main`, folder `/ (root)`.
2. Open `https://rbahrami.github.io/EinsteinWallpaper/`.

Option B — locally: just open `index.html` in any modern browser (double-click it).
No build step, no server needed.

### Generate a wallpaper

1. Pick an **aspect ratio** and **resolution** (or type a custom size).
2. Adjust **tile scale**, colors, palette and rotation to taste (or hit *Randomize*).
3. Click **⬇ PNG (full res)** to save a still wallpaper at the exact target resolution.

### Make a live wallpaper

1. Choose an **Animation** effect and speed, then preview it in the canvas.
2. Click **⏺ Record WebM** — the recorded video downloads as `.webm`.
3. Apply it:

| Platform | How |
|----------|-----|
| **Windows** | [Lively Wallpaper](https://www.rocksdanister.com/lively) (free, open source): *Add Wallpaper* → paste this page's URL to run the interactive web version, or drag in the exported `.webm` as a video wallpaper. Wallpaper Engine also works. |
| **Android** | Use any "video live wallpaper" app (e.g. *Video Live Wallpaper*, or Wallpaper Engine's Android companion) and pick the exported `.webm`. Convert to MP4 first if your app prefers it (e.g. with `ffmpeg -i in.webm out.mp4`). |
| **Any OS** | Set the page as your browser's startup/new-tab page for an always-on animated background. |

> Tip: recordings are captured at the preview resolution (up to ~1920 px wide). For
> crisp 4K results, export a PNG; for smooth motion, WebM at 1080p looks great on
> desktop wallpaper engines.

## How the tiling works

The renderer implements the substitution system described in Section 4 of the paper:
four auxiliary *metatiles* (H hexagon, T triangle, P parallelogram, F pentagon) are
repeatedly expanded through a fixed 29-tile patch, and the hat-shaped leaves at the
bottom of the expansion are drawn. Before rendering, the app verifies — by rasterizing
the actual cluster — that the canvas maps into a fully-tiled region, so there are never
gaps or overlaps on screen.

```
js/hat-tiling.js   metatile construction + expansion engine (browser & Node)
js/render.js       fitting, coloring, drawing, animation, export
js/palettes.js     palette library + color helpers
js/app.js          UI wiring
```

Run the geometric verification yourself (Node 18+):

```bash
node scripts/verify_tiling.js
```

## Credits

- Mathematical construction: D. Smith, J. S. Myers, C. S. Kaplan, C. Goodman-Strauss,
  *"An Aperiodic Monotile"*, arXiv:2303.10798 (2023) — https://cs.uwaterloo.ca/~csk/hat/
- Inspired by the Quanta Magazine coverage of the discovery (April 2023).

## License

MIT — see [LICENSE](LICENSE).
