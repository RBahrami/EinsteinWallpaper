# Examples — minimal one-layer starter projects

Each example here is a **minimal Tessellate project**: one pattern layer over a
background layer, stored as a bare JSON project object (the simplest of the
three file shapes the loader accepts), next to a full-resolution PNG rendered
by the app's own **Export → PNG** path.

| File | Family / look |
|---|---|
| [`hat-aurora.json`](hat-aurora.json) · [render](hat-aurora.png) | Einstein hat, Palette mode (Aurora, supertile arrangement), solid midnight background |
| [`hexagons-mint.json`](hexagons-mint.json) · [render](hexagons-mint.png) | Flat honeycomb, built-in Aurora gradient sweeping across, linear gradient background |
| [`penrose-ember.json`](penrose-ember.json) · [render](penrose-ember.png) | Penrose rhombs (golden), duotone checkerboard, radial ember background |

## How to use

1. Open Tessellate (`index.html`, or the GitHub Pages URL).
2. Click **Load** in the top toolbar and pick one of the `.json` files.
3. Tweak anything — every value is live. **Save** exports the project JSON,
   the **Export** menu renders PNG / GIF / APNG at the canvas resolution
   stored in the file (1920×1080 for all three).

## Notes for agents

These files double as templates for generated wallpapers: copy one, adjust
`name`, `resW`/`resH`, the `family`/`variant` and the `theme` block, and you
have a valid project — the loader clamps/repairs any out-of-range values.
The full field reference is [`../docs/AGENT_GUIDE.md`](../docs/AGENT_GUIDE.md).
