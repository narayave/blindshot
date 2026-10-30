---
name: blindshot-new-event
description: Spin up a new blindshot event site (its own link, QR code, roll, look, schedule and lock) so guests can scan, join and start shooting in minutes. Use this whenever the user mentions a new party, night, event, gig or occasion for blindshot, wants "another site" or "a separate environment" for a night, a new theme or look for an event, a shot count, event times (when it opens, ends, or the roll releases), turning an event or its roll on/off, or what an event costs or should be charged, even if they don't say "event". Also use it to change an existing event's name, date, times, shots or theme.
---

# New blindshot event

Every event is one row in the `events` table, served at `/e/<code>`. Separate nights get separate events: each has its own
roll, QR code, schedule, lock and darkroom view, so photos from two nights never mix, and one night's link never opens
another (an event that isn't open is a 404).

## Ask before creating (don't guess these)

1. **Name and date** (shown at the top of the page; the subtitle is usually the date).
2. **Start time** on the night. Pacific time.
3. **Shots per roll.** They've used 6 for demos, 9 for Halloween, 13 for the main event. Guests can always load
   another roll when one is finished, so this sets the rhythm, not a hard cap.
4. **Look:** reuse a theme, or a new one so the night feels different.

## The schedule (the user's standard night)

- **Opens** at the start time: before that, the link is a 404 for everyone but the host.
- **Shooting stops at 2am** the next morning. The camera then says the night's over; uploads already in flight get 15
  minutes' grace.
- **Roll released at 8am** the next day. Guests see every photo from the night; the worker has hours to finish developing
  (it does ~30 photos a minute).
- Guests are never shown photos before the release. They can use **Load a new roll** any time until 2am.

`npm run event` computes 2am and 8am from `--opens` (Pacific, daylight-saving safe); pass `--closes` / `--release` only
to change them.

## Steps

1. **Pick a code** (lowercase, digits, dashes; it's the URL). Never rename a code a link may already have gone out
   for: make a new one instead. `admin` is taken (`/e/admin` is the host's events page). Check what exists first:
   ```bash
   node --env-file=.env.local -e 'const {sql}=await import("./lib/db.ts"); console.log(await sql`select code, name, subtitle, theme, max_shots, online, opens_at, closes_at, release_at from events order by created_at`); await sql.end()' --input-type=module
   ```
2. **Theme.** Reuse one from `lib/themes.ts` (`base`, `diwali`, `halloween`, `haunted`, …) or make one with
   [references/themes.md](references/themes.md). A new theme is a website change: push to `main` before the night.
3. **Create or update the event.** `scripts/event.ts` writes *every* field, so on an update pass all the options again:
   ```bash
   npm run event -- --code halloween --name "Halloween Night" --subtitle "Sat Oct 31" \
     --theme halloween --shots 9 --overlays --opens "2026-10-31 18:00"
   ```
   It prints the opening, closing and release times back: read them to the user. `--overlays` adds the film artifacts
   and burns; mention that the artifacts pack is personal-use only if the event is commercial (burns allow commercial use).
   Event names can carry a partner's brand: fine in the database, but keep partner names out of anything committed
   (the repo is public), including examples in docs and skills.
   **Careful when editing a night that's already open:** `--opens` in the future closes the link until then. To keep a
   live event live, pass an `--opens` a few minutes in the past (and its `--closes`/`--release` explicitly).
4. **Ship the theme** if you made one: typecheck, `npm test`, commit, push, wait for the deploy
   (`gh run watch $(gh run list -b main -L 5 --json databaseId,headSha -q ".[] | select(.headSha==\"$(git rev-parse HEAD)\") | .databaseId") --exit-status` (wait a few seconds after pushing so the run exists; matching the commit avoids watching the previous deploy)).
5. **Check it live** with the bundled script. It reports the schedule; for an open event it joins as a throwaway guest,
   confirms the lock and deletes that guest; for one that isn't open yet it confirms the link is a 404:
   ```bash
   node --env-file=.env.local .claude/skills/blindshot-new-event/scripts/check-event.ts halloween
   ```
6. **Hand over:** the guest link `https://<site>/e/<code>` (also printed as a QR code in the darkroom and on the join
   page itself, so guests can bring friends in), the host's events page `https://<site>/e/admin`, and the darkroom
   `https://<site>/admin?event=<code>`, which shows every photo about a minute after it's taken.
7. **Cost and price**, if asked or for a paid event: [references/pricing.md](references/pricing.md) has the per-photo
   and per-event costs from the real Azure bill, how to refresh them, and a pricing starting point.

## The host's controls

- **`/e/admin`** (host password): every event with two switches. **Event** off = the link is a 404 for everyone but
  the host (who sees an orange "This event is OFF" banner). **Roll** on = guests see the whole roll now. Both override
  the schedule. Without `--opens`, a new event starts off until the host switches it on.
- **Returning guests:** the same first name + Instagram on another phone or a later visit counts as the same person,
  so their earlier shots show under **Mine**. It isn't a password; guests without Instagram only see this visit's shots.
- **Start over** (demo photos out, fresh rolls): `npm run reset -- <code> [--shots N]`. It deletes every photo and
  guest of that event and can't be undone, so confirm with the user first.
