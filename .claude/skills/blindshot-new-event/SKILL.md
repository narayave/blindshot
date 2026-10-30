---
name: blindshot-new-event
description: Spin up a new blindshot event site (its own link, QR code, roll, look and lock) so guests can scan, join and start shooting in minutes. Use this whenever the user mentions a new party, night, event, gig or occasion for blindshot, wants "another site" or "a separate environment" for a night, a new theme or look for an event, a different shot count, the new-roll button, or locking/unlocking/releasing a roll, even if they don't say "event". Also use it to change an existing event's name, date, shots or theme.
---

# New blindshot event

Every event is one row in the `events` table, served at `/e/<code>`. Separate nights get separate events: each has its own
roll, QR code, lock and darkroom view, so photos from two nights never mix.

## What a good event looks like (the user's defaults)

- **Locked roll.** Guests shoot but never see photos until the host unlocks it. Leave out `--release`; the host unlocks
  with **Release the roll now** in the darkroom (`/admin?event=<code>`). Only set `--release <time>` if asked.
- **New-roll button on** (`--new-rolls`): after the last shot a guest taps **Load a new roll** and keeps shooting,
  no re-joining. Without it, a guest gets exactly one roll.
- **Overlays on** (`--overlays`): film artifacts and burns from the licensed packs on some frames. Mention that the
  artifacts pack is personal-use only if the event is commercial; the burns pack allows commercial use.
- **Shots:** ask or take what the user says (they've used 6 for demos, 9 for Halloween, 13 for the main event).
- **Its own look** when the user wants the nights to feel different: a theme (see below).

## Steps

1. **Pick a code** (lowercase, digits, dashes; it's the URL). Never rename a code a link may already have gone out
   for: make a new one instead. Check what exists first:
   ```bash
   node --env-file=.env.local -e 'const {sql}=await import("./lib/db.ts"); console.log(await sql`select code, name, subtitle, theme, max_shots, new_rolls, overlays, release_at from events order by created_at`); await sql.end()' --input-type=module
   ```
2. **Theme.** Reuse one from `lib/themes.ts` (`base`, `diwali`, `halloween`, …) or make a new one with
   [references/themes.md](references/themes.md). A new theme is a website change: it needs a push to `main` to go live.
3. **Create or update the event.** `scripts/event.ts` is an upsert that writes *every* field, so on an update pass all
   the flags again, or a re-run quietly turns overlays/new rolls off:
   ```bash
   npm run event -- --code halloween-fri --name "Halloween Eve" --subtitle "Fri Oct 30" \
     --theme halloween --shots 9 --new-rolls --overlays
   ```
   Event names can carry a partner's brand: that's fine in the database, but keep partner names out of anything
   committed (the repo is public), including examples in docs and skills.
4. **Ship the theme** if you made one: typecheck, `npm test`, commit, push, wait for the deploy
   (`gh run watch $(gh run list -b main -L 5 --json databaseId,headSha -q ".[] | select(.headSha==\"$(git rev-parse HEAD)\") | .databaseId") --exit-status` (wait a few seconds after pushing so the run exists; matching the commit avoids watching the previous deploy)).
5. **Check it live** with the bundled script. It joins as a throwaway guest, confirms the lock, and deletes that guest:
   ```bash
   node --env-file=.env.local .claude/skills/blindshot-new-event/scripts/check-event.ts halloween-fri
   ```
6. **Hand over** two links: the guest link `https://<site>/e/<code>` (also on the darkroom's printable QR code) and the
   host link `https://<site>/admin?event=<code>`, which shows every photo about a minute after it's taken, even while
   the roll is locked.

## Later in an event's life

- **Unlock / lock for guests:** the host's events page `https://<site>/e/admin` (host password) has an On/Off switch per
  event. The darkroom's **Release the roll now** / **Hide the roll again** do the same for one event. Never create an
  event with the code `admin`: that address is the events page (`scripts/event.ts` refuses it).
- **Start over** (demo photos out, fresh rolls): `npm run reset -- <code> [--shots N]`. It deletes every photo and
  guest of that event and can't be undone, so confirm with the user first.
- **Demo vs real night:** a demo usually runs released with few shots; before the real night set the shots back,
  lock the roll, and reset.
