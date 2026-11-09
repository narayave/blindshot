# Metrics and the data model

## Data model (Supabase Postgres)

| Table | One row per | Key columns |
|---|---|---|
| `events` | event | `opens_at`, `release_at` (album opens), `closes_at` (shooting stops), `max_shots` |
| `sessions` | sign-up (a name on a phone) | `created_at`, `device_id` (hashed phone cookie), `shot_count`, `rolls`, `user_agent`, `instagram` |
| `photos` | photo | `session_id` (who took it), `captured_at`, `status` (`done` = developed), `starred`, `hidden` |
| `visits` | page load or event on a phone | `visitor` (hashed phone cookie), `kind`, `detail`, `at` |

`visits.kind`:

- Pages: `soon` (coming-soon page), `join` (sign-up page), `camera`, `album` (detail: `picks` | `mine` | `all`).
- Engagement: `photo` (opened in the viewer; detail = photo id; once per photo per visit), `save` (detail = photo id).
- Camera: `cam-live` (detail: side + stream size), `cam-off` (detail: browser error), `cam-stuck` (no camera in 8 s),
  `shot`, `shot-fail`, `blocked` (SHOOT pressed but nothing happened; detail: `not wound`, `camera off`, `busy`…).

A **phone** is a `visitor` / `device_id`. A sign-up joins its visits through `sessions.device_id = visits.visitor`.

## Definitions

- **On the night:** a sign-up created before `closes_at` + 15 min. Later sign-ins are **after the party** (they
  came to see the album). Stats on the album page (cameras, rolls) count only on-the-night sign-ups.
- **Opened the link:** phones with a `soon`/`join`/`camera` visit before closing.
- **Saw the sign-up:** phones with a `join` visit between opening and closing.
- **Shooter:** an on-the-night sign-up with at least one photo.
- **Album viewer:** a phone with an `album` visit after `release_at`. Types: *guest from the night* (signed up on the
  night), *signed in after the party*, *picks only* (never signed in: saw only the host's starred photos).
- **Picks → sign-in:** of phones that opened the album while not signed in, the share that signed in afterwards.
- **Came back:** on-the-night sign-ups whose phone opened the album.
- **Long tail:** new album viewers per day after the release (D0 = release day, Pacific).
- **Saves of others' photos:** saves where the saver's phone didn't take the photo: the best proxy for "people
  looking for photos of themselves".

## Conversion rates to quote

| Rate | Formula |
|---|---|
| Visit → sign-up | signed up on the night / opened the link |
| Sign-up page → sign-up | signed up on the night / saw the sign-up |
| Activation | shooters / signed up on the night |
| Return | came back to the album / signed up on the night |
| Picks → sign-in | as above |
| Depth | photos per shooter (median and mean; the gap shows how much a few power users carry) |
