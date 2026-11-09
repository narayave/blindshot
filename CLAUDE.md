@AGENTS.md

# blindshot: context for any Claude session

Read this first. The README has the full architecture; this file is what you need to keep working the way the owner
works. The repo is **public**: never commit secrets, partner/brand/people names, guests' photos, or licensed overlay files.

## What this is, and why

Vintage and nostalgic experiences, made digital so everyone can have them: things people want but can't easily get
(time, gear, money). A disposable camera, an instant camera, a photobooth strip, Super 8 film. **The experience is the
product.** Not seeing photos until the roll opens builds anticipation; the best moment of a night is everyone looking
through the roll together ("look what I got!"). Guests scan a QR code, shoot blind on a limited roll, load another roll
when it's done, and the shared roll opens at a set time while the party is still on.

## How the owner likes to work

- Ask before anything that costs money (new Azure resources, paid services) or can't be undone (deleting photos or
  events, force-pushes, merging to `main` from a PR). Routine commits and pushes to `main` are fine.
- Show, then ship: preview any look change as a labelled comparison sheet on **real photos from the latest event**
  (see the look-lab skill), get a pick, then deploy. Keep live events stable: don't change an event that's in progress
  unless asked; build new behaviour behind a per-event setting or on `/e/test`.
- Answers in plain words, short. Explain trade-offs, recommend one option.
- Commits: noreply email `3068089+narayave@users.noreply.github.com`, message ends with the Co-Authored-By line.

## Map

| Piece | Where | Ships with |
|---|---|---|
| Guest camera, join, wrap screen | `app/e/[code]/CameraApp.tsx` (+ `Countdown.tsx`, `HostOnly.tsx`) | push to `main` |
| Shared roll + swipe viewer + stats | `app/e/[code]/roll/` | push to `main` |
| Host: events page (switches), darkroom | `app/e/admin/page.tsx`, `app/admin/` | push to `main` |
| API: join, reserve shot, complete, new roll | `app/api/` | push to `main` |
| Film filter (pure function), looks, strips, cards | `lib/film.ts` (`LOOKS`, `developStrip`, polaroid card) | `scripts/deploy-worker.sh` |
| Queue + develop one photo | `lib/process.ts` | `scripts/deploy-worker.sh` |
| Worker (Azure Functions, timer every minute, 512 MB) | `worker/index.ts` | `scripts/deploy-worker.sh` |
| Schema (idempotent, additive) | `supabase/schema.sql` | apply by hand to prod, then deploy code |

The website runs on **Node 20** (Azure; `engines` in package.json) while local Node is newer: no `Map.groupBy` or other
Node 21+ APIs in `app/` or `lib/` (a darkroom page once crashed only in prod).

Website changes go live on push; **filter/queue changes only go live with `scripts/deploy-worker.sh`.** Deploy the
worker first when both change.

## Commands

`npm test` (all browsers; ~1.5 min) · `npm run event -- …` (create/update an event; full update, pass every option)
· `npm run reset -- <code>` (wipe an event's photos and guests: confirm first) · `npm run cleanup` (leftover test
events) · `npm run load -- 100` (burst test against the live site) · `npm run overlays -- artifacts|burns …` · `npm run wiggle -- <code>` (render wigglegrams)
· health: `node --env-file=.env.local .claude/skills/blindshot-ops/scripts/health.ts`

## Skills (in `.claude/skills/`)

- `blindshot-new-event`: new night = new event (code, theme, shots, schedule, look, credit), check it live, pricing.
- `blindshot-look-lab`: preview and ship film looks; overlay packs and their licences.
- `blindshot-ops`: deploy, verify, health, load, recovery, event night.

## Product rules that are easy to break

- **Schedule:** `--opens` (Pacific). Defaults: shooting stops 2am, roll opens at midnight (both overridable). Before
  `--opens`, a switched-on event shows guests a **coming-soon page** (what it is, sample prints, share QR, "Sign-ups
  open in" countdown) so a promo post can link to it; no sign-up, consent or camera until then, the page turns into
  the sign-up by itself, and the join/photo/album endpoints refuse anything early. Switched off = a 404 for guests
  (not even its name); the host sees an orange banner and the full app either way.
- **Guests never see a photo before release.** New rolls are unlimited until closing. **Mine = this phone**: a random
  id in a long-lived site-wide cookie (`bs_device`, hashed into `sessions.device_id`); name + Instagram never unlock
  anyone's frames. The darkroom shows each photo's phone and flags a name+handle seen on two phones.
- **Album access (9 Nov, after Diwali):** not signed in = the host's starred picks only, look-only, plus "Were you
  there?" (name + optional Instagram + a tick: be respectful, credit the photographer if you share). Signed in, at the
  party or afterwards = the whole album, saving included (guests want the photos others took of them). Sign-ins after
  shooting closed don't count as "cameras"/"rolls" in the stats. Everyone tab: starred first, then a per-viewer shuffle.
- **Roll stats:** photos = every photo taken (incl. private-roll frames), with a "N were kept private" note; host picks
  count only shared frames so the Picks tab matches. The events page (`/e/admin`) shows guests, rolls, photos.
- **Roll page** shows "Posting a frame? Tag @handle" and "Want a roll at your party? Message": always the maker's
  handle (`MAKER_HANDLE` in `lib/config.ts`), whatever credit the photos carry.
- **Join-page sample prints** (`public/samples/`) are the host's own photos, picked by the owner to show off the film
  effects (6 Nov: three Halloween frames re-developed without the credit; the promo post uses a separate set), web-size 480x640, no EXIF, no clearly
  recognisable guests (the repo is public); the caption says they are picks.
- **House look (updated 6 Nov for Diwali):** `green-night` + `--overlays`, 9 shots, no opt-outs (default;
  `--opt-outs` re-enables them), **no `--credit`** (each photo carries its guest's @handle, else first name, so every
  frame can be traced to who took it) and **`--date-stamp`** (kept: the signature dispo look, balanced against the
  handle, and it records when). Halloween used host credit + date stamp.
- **Consent (events without opt-outs):** "Shoot free, get every photo": all photos go into one shared album everyone
  can see and save; hosts and event partners may use them in promotional content. Load film stays disabled until the
  box is ticked, and `/api/session` rejects a join without consent.
- **Export for posting:** `npm run export` re-develops (same seed, pixel-identical) without the credit into
  `~/Desktop/blindshot-posts`; never uploaded. The site always keeps the credit.
- **Wigglegrams:** guests shoot one subject on the count of 3; the darkroom's Wiggles tab lists shots from 2+ phones
  within 3 s (capture times are clock-corrected on upload), the host unticks strays and presses Make a wiggle
  (`photos.wiggle`). Frames align on their centres (the owner has everyone shoot the same subject, same orientation);
  tapping the subject (`wiggle_x/y`) is only for a preview that jumps. `npm run wiggle -- <code|id>` renders locally: shared seed, no pan/shake, one date
  stamp (if the event has them), colour matched to the middle frame, 4:5 crop centred on the subject; 0.2 s a frame (`--speed`). One tap fixes
  position, not size: a subject much closer to one phone looks bigger in that frame.
- **Credit:** without `--credit`, each photo credits whoever took it (the default now). `--credit "@handle"` puts one
  fixed handle on every photo instead (Halloween used the host's).
- **Looks** (`LOOKS` in `lib/film.ts`, names mirrored in `LOOK_NAMES` in `lib/config.ts`): default 35mm disposable,
  `night`, `green`, `green-night`, `polaroid` (2:3 card, portrait only), `photobooth` (B&W sepia, 3-2-1 burst of four,
  front camera, strip). `--date-stamp`: 90s amber LED date/time, Pacific. Offline events show a look picker to the host.
- **Camera:** controls in a bottom bar for one thumb; layout never rotates (labels do); flash is **off by default**;
  flash = phone light held until exposure settles (only where the browser can switch it on: Chrome on Android yes,
  Firefox on Android no, so there it says "No flash in this browser" and does no fake white pop); selfie = screen
  as flash, kept short (~0.35-0.7 s, `SCREEN_MIN_MS`/`SCREEN_MAX_MS`); phone light 0.25-0.8 s, recharge 0.8 s, and a
  shot pressed mid-recharge waits for it rather than going out dark. The shutter fires on press, not release. Uploads never block: each shot is claimed in
  order, photos upload in parallel in the background, and "Load a new roll" is instant (no page reload).
- **Times** are Pacific everywhere guests see them; the worker runs in UTC. DST nights: use wall-clock helpers.

## Events (prod)

`test` is the owner's private bench (on; leave it alone). `polaroid`, `halloween-fri` and `halloween` are switched off
(404s; photos kept). **`diwali` (Sat Nov 7, a partner event):** theme `diwali` (styled after the partner's posts), the
house look, 9 shots; sign-ups open 6pm PT, album opens Sun 2am, shooting stops 3am. Its name, subtitle and promo
material are only in the database and the owner's local `~/Desktop/blindshot-posts/` (never in the repo). Updating it:
`npm run event -- --code diwali --name "<name>" --subtitle "<subtitle>" --theme diwali --shots 9 --overlays --date-stamp --look green-night --opens "2026-11-07 18:00" --release "2026-11-08 02:00" --closes "2026-11-08 03:00"`
(read the current name and subtitle from the events table first).

**Not tested on a real iPhone before Diwali (owner tested Android Chrome/Firefox only; automated WebKit tests pass):**
the selfie switch (Safari used to open the back camera; fixed with `facingMode: { exact }`), whether Safari can switch
on the phone's light for flash (if not, guests see "No flash in this browser"; selfie screen-flash still works), the
coming-soon page turning into the sign-up at opening time, and background uploads on Safari. Check these on an
iPhone first if anything is reported from that night.

**During a live event:** one change at a time; `npm test`; deploy; verify on the live site (check-event / health);
never change the live event's settings unless asked.

## Backlog (agreed ideas, not built)

- **Say "no AI" (owner, 8 Nov, after Diwali):** a guest asked whether the photos are AI-edited. They aren't: the film
  look is a fixed, rule-based filter (grade, grain, leaks, dust, overlays) applied the same way to every frame. Say so
  on the join page / How it works (e.g. "No AI: a film filter, the same for every shot") and in the README.
- **Host hides a photo from Everyone, the photographer keeps it (owner, 8 Nov):** darkroom Hide today removes a photo
  from the photographer's Mine too (`not p.hidden` in the album query). Make Hide mean "not in Everyone", still in
  the photographer's Mine; per-guest "keep all of theirs off Everyone" already exists as `sessions.private_roll`.

- **Provenance on every exported photo (owner asked, 1 Nov):** whenever a photo is personalised for posting (credit
  removed, re-developed, cropped), record who took it and what was applied, so it can be traced later. Done so far:
  `carousel/manifest.csv` (slide, photo id, event, photographer, look, date stamp, overlays, seed, credit, what was
  removed). To build: (1) `scripts/export.ts` writes that manifest for every export; (2) a tiny visible code on the
  photo (a few-mm dot strip or short id like a film edge code, e.g. `BS·b446`) that survives Instagram's metadata
  stripping, decoded by a lookup page; (3) the photo id + settings in the JPEG's XMP for files shared directly.

- **Super 8 video** event mode: short clips (a cartridge: ~3 × 10 s per guest), worker runs ffmpeg: 18 fps, gate weave,
  flicker, grain/dust, rounded gate, and a **Technicolor** grade (rich saturated primaries, warm skin, deep
  blacks, vintage). Needs a video worker or more memory; real-device testing. ~2–3 days. Cost mostly viewing (~$6/event).
- **Photobooth backdrop:** a clean off-white background can't be enforced in software cheaply; best is a physical
  corner (cream sheet/curtain + one lamp) with its own QR "booth" sign. Optional later: in-browser person
  segmentation (MediaPipe) to replace the background.
- Native app (BeReal-like reach), auto-brighten very dark frames, light streaks on flash shots
  (`lab/light-streaks.parked.ts.txt`), group games at release (scavenger hunt), "photos of you" tagging,
  host top picks first at the reveal, a worker that sleeps when no event is live.
