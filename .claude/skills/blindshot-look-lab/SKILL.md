---
name: blindshot-look-lab
description: Try, compare and ship changes to blindshot's film look: grade, grain, leaks, overlays and burns, slow-shutter shake, panned motion blur, or any new photo effect. Use this whenever the user shares a reference photo ("can we get this effect?"), wants photos warmer/greener/more contrasty, wants an overlay stronger or softer, picks overlays from a pack, or asks how often an effect should appear, even if they only say "make the photos look like this".
---

# blindshot look lab

The film look is one pure function, `applyFilmFilter` in `lib/film.ts`, run by the worker on every upload. Changing it
changes every photo developed afterwards, so the rule in this project is **show the user examples first, ship second**.
They decide by eye, often in two or three rounds ("too strong", "the second column", "subtler").

## Loop

1. **Name the look.** For a reference photo, say in a sentence what's physically happening (e.g. "flash freezes the
   subject while the shutter drags, so only lights streak") before coding. It picks the technique and sets expectations.
2. **Photos:** `lab/in/` (gitignored, private) holds the user's test photos. Party shots with lights, faces near the
   middle and off-centre, and one daylight frame make a fair test. Ask for better ones when an effect depends on content
   (light streaks need point lights).
3. **Prototype** the effect in `lib/film.ts` as an option that defaults off, then render a sheet:
   ```bash
   node .claude/skills/blindshot-look-lab/scripts/compare.ts lab/out/<name>.jpg lab/cols.json   # columns: see script header
   open lab/out/<name>.jpg   # the user looks at it in Preview
   ```
   Always include a "Today" column, and two seeds of the new variant so they see it isn't one fixed stamp. Look at the
   sheet yourself before showing it: broken output (noise, hard edges, blown-out frames) wastes a round.
4. **Iterate** on their words. When they pick a column, ship that exact setting.
5. **Ship:** set the chance in `DEFAULT_FILM`, add a check to `e2e/filter.spec.ts` (deterministic per seed, plus one
   property that fails if the effect breaks), `npm test`, then **deploy the worker** (`scripts/deploy-worker.sh`; a push
   alone doesn't change the worker), commit and push. Describe the effect in the README's film-filter section.

## How effects are built here (keep new ones consistent)

- **Rare effects get their own random stream**: `mulberry32(o.seed ^ <constant>)`, so adding one doesn't reshuffle
  grain, leaks or dust on every other frame. Mutually exclusive effects (pan vs shake) share a decision.
- **Rates the user settled on:** artifact overlay ~1 in 12, burn ~1 in 10 at strength 0.5, shake ~1 in 8, pan ~1 in 10.
  They like "subtle, and different from a normal photo"; today's base grade is the one they prefer (a greener,
  contrastier base was rejected).
- **Motion effects work on the raw RGB buffer before the tone curve.** Use O(n) tricks (running sums along a line,
  stamping only bright pixels) rather than per-pixel kernels: the worker develops ~1 photo/s.
- **Subjects are usually near the middle**: the pan smears lightly in the centre and fully at the edges. Say so when an
  effect can't protect an off-centre face.
- **Overlays use screen blending**: black is invisible, so take out each image's own black level, zoom in enough that a
  tilt never shows an edge, and randomise zoom/crop/flip/tilt per photo so nothing repeats.
- **sharp gotchas:** `stats()` reads the *input*, so crop to a buffer before measuring a region; `resize` runs before
  `composite` in one pipeline, so composite to a buffer first when you then shrink.

## Per-event looks

When a change should apply to some events only ("darker for tomorrow, leave tonight alone"), add it as a named entry in
`LOOKS` (`lib/film.ts`) instead of changing `DEFAULT_FILM`, preview it with compare.ts (the entry's options as a
column), deploy the worker, and set it on the event with `npm run event -- … --look <name>`. `night` is the first:
deeper blacks, more contrast, brights that glow and clip a little.

## Overlay packs (licensed images)

- Read the pack's license PDF before using it. Personal-use packs can't go into a commercial event without a commercial
  license; no pack's files may be redistributed. That's why they live only in gitignored `overlays/<kind>/` and inside
  the worker package, never in git (the repo is public).
- Pick by number from a contact sheet:
  `node .claude/skills/blindshot-look-lab/scripts/pack-sheet.ts "<pack folder>" lab/out/pack.jpg`, then
  `npm run overlays -- burns "<pack folder>" 01 15 47 58` (or `artifacts …`). Kinds, rates and strengths are in
  `KINDS` in `lib/process.ts`. Preview with an `overlay` column in compare.ts before deploying the worker.
- Overlays only apply to events created with `--overlays`.

## Parked work

`lab/light-streaks.parked.ts.txt` holds a working "lights streak on flash shots" effect. Shipping it also needs the
phone to send whether the flash was on (CameraApp → `/api/photos/complete` → a `photos.flash` column). The user wanted
to see it on photos with string lights first.
