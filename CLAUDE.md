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

Website changes go live on push; **filter/queue changes only go live with `scripts/deploy-worker.sh`.** Deploy the
worker first when both change.

## Commands

`npm test` (all browsers; ~1.5 min) · `npm run event -- …` (create/update an event; full update, pass every option)
· `npm run reset -- <code>` (wipe an event's photos and guests: confirm first) · `npm run cleanup` (leftover test
events) · `npm run load -- 100` (burst test against the live site) · `npm run overlays -- artifacts|burns …`
· health: `node --env-file=.env.local .claude/skills/blindshot-ops/scripts/health.ts`

## Skills (in `.claude/skills/`)

- `blindshot-new-event`: new night = new event (code, theme, shots, schedule, look, credit), check it live, pricing.
- `blindshot-look-lab`: preview and ship film looks; overlay packs and their licences.
- `blindshot-ops`: deploy, verify, health, load, recovery, event night.

## Product rules that are easy to break

- **Schedule:** `--opens` (Pacific). Defaults: shooting stops 2am, roll opens at midnight (both overridable). An event
  that isn't open, or is switched off, is a 404 for guests (not even its name); the host sees an orange banner.
- **Guests never see a photo before release.** New rolls are unlimited until closing. **Mine = this phone**: a random
  id in a long-lived site-wide cookie (`bs_device`, hashed into `sessions.device_id`); name + Instagram never unlock
  anyone's frames. The darkroom shows each photo's phone and flags a name+handle seen on two phones.
- **Roll stats:** photos = every photo taken (incl. private-roll frames), with a "N were kept private" note; host picks
  count only shared frames so the Picks tab matches. The events page (`/e/admin`) shows guests, rolls, photos.
- **Roll page** shows "Posting a frame? Tag @handle" (from the event's credit) and "Want a roll at your party? Message".
- **Join-page sample prints** (`public/samples/`) are the host's own photos, hand-picked, no recognisable faces (motion blur is fine), web-size, no EXIF; the caption says they are picks.
- **Credit:** `--credit "@handle"` puts the host's handle on every photo (the owner's choice: he introduces people to
  the product). Without it, each photo credits whoever took it.
- **Looks** (`LOOKS` in `lib/film.ts`, names mirrored in `LOOK_NAMES` in `lib/config.ts`): default 35mm disposable,
  `night`, `green`, `green-night`, `polaroid` (2:3 card, portrait only), `photobooth` (B&W sepia, 3-2-1 burst of four,
  front camera, strip). `--date-stamp`: 90s amber LED date/time, Pacific. Offline events show a look picker to the host.
- **Camera:** controls in a bottom bar for one thumb; layout never rotates (labels do); flash = phone light held until
  exposure settles; selfie = screen as flash.
- **Times** are Pacific everywhere guests see them; the worker runs in UTC. DST nights: use wall-clock helpers.

## Events (prod)

`test` is the owner's private bench: off (404 to guests), 1 shot, look picker. `polaroid` is the instant-film trial.
`halloween-fri` is done (released). **`halloween` (Sat Oct 31, a live event at a rooftop venue):** theme `ember`,
look `green-night`, 13 shots, `--date-stamp`, `--overlays`, credit = host's handle; opens 6pm PT, roll opens midnight,
shooting stops 1:30am. Re-run with all of these if you ever update it:
`npm run event -- --code halloween --name "Halloween Night" --subtitle "Sat Oct 31" --theme ember --shots 13 --overlays --date-stamp --opens "2026-10-31 18:00" --closes "2026-11-01 01:30" --release "2026-11-01 00:00" --look green-night --credit "@veefaceswest"`

**During a live event:** one change at a time; `npm test`; deploy; verify on the live site (check-event / health);
never change the live event's settings unless asked.

## Backlog (agreed ideas, not built)

- **Super 8 video** event mode: short clips (a cartridge: ~3 × 10 s per guest), worker runs ffmpeg: 18 fps, gate weave,
  flicker, grain/dust, rounded gate, and a **Technicolor** grade (rich saturated primaries, warm skin, deep
  blacks, vintage). Needs a video worker or more memory; real-device testing. ~2–3 days. Cost mostly viewing (~$6/event).
- **Photobooth backdrop:** a clean off-white background can't be enforced in software cheaply; best is a physical
  corner (cream sheet/curtain + one lamp) with its own QR "booth" sign. Optional later: in-browser person
  segmentation (MediaPipe) to replace the background.
- Native app (BeReal-like reach), auto-brighten very dark frames, light streaks on flash shots
  (`lab/light-streaks.parked.ts.txt`), group games at release (scavenger hunt), "photos of you" tagging,
  host top picks first at the reveal, a worker that sleeps when no event is live.
