# Making a theme

A theme is a set of CSS tokens on `.shell` plus a little copy. Three places:

1. **`app/globals.css`**: add `.theme-<name> { … }` next to the others. Copy the whole `.theme-halloween` block and change
   the values; every token must be set or that part of the UI falls back to nothing. What they colour:

   | Token | Used for |
   |---|---|
   | `--bg` `--bg-2` `--fg` `--muted` `--line` | page background, panels, text, secondary text, hairlines |
   | `--dots` `--dots-2` | the two-colour dot pattern on the page background (`transparent` for none) |
   | `--body` `--body-2` `--well` `--cam-fg` `--cam-muted` | the camera body, its trim, the viewfinder well, text on the camera |
   | `--ridge` `--ridge-ready` `--vf-ring` | wind wheel ridges (idle / wound), viewfinder ring |
   | `--accent` `--accent-2` `--hot` `--on-accent` | main accent, second accent, hot colour (wordmark shadow), text on accent |
   | `--cta` `--cta-ink` `--cta-shadow` | big buttons |
   | `--shutter` `--shutter-deep` `--shutter-ink` `--shutter-ring` | the SHOOT button |
   | `--hl-em` `--hl-shadow` `--hl-font` `--hl-weight` `--hl-stretch` | headlines and their emphasised word |
   | `--band` | the three-stripe band (a hard-stop linear-gradient) |
   | `--chip-bg` `--chip-fg` `--leaf` `--flash` | label chip on the camera, leaf colour in decor, the flash overlay |
   | `color-scheme` | `dark` for dark themes (form controls follow) |

   Optional per-theme overrides follow the block, e.g. `.theme-halloween .wordmark { … }` and the `.stripes` colours.
   Check contrast: text on `--bg` and `--cta-ink` on `--cta` should be easy to read in a dark room.

2. **`lib/themes.ts`**: add `<name>: { chip: "SHORT LABEL", decor: false }`. `chip` is the label printed on the camera
   body; `decor: true` shows the hanging toran garland (Diwali), false shows the three stripes.

3. **Font (optional)** in `app/layout.tsx` via `next/font/google`: import it, create it with
   `variable: "--font-<x>"`, add `.variable` to the `<html>` className, and use `var(--font-<x>)` in `--hl-font`.
   Check the font exists first:
   `node -e 'const d=require("./node_modules/next/dist/compiled/@next/font/dist/google/font-data.json"); console.log(d["Font Name"])'`.
   Display fonts (Creepster, Rozha One) only for headlines and the wordmark; body text stays Instrument Sans.

Unknown theme names fall back to `base` silently, so after deploying, `check-event.ts` confirms the page actually carries
`theme-<name>`. To see it before deploying: `npm run dev`, point an event at the theme, open `/e/<code>` at phone width.
