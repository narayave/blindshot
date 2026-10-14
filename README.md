# blindshot

*a disposable camera for your party*

Guests scan a QR code and get a 13-shot roll in a one-inch viewfinder. No previews: they wind the film, hit the shutter, and never see the frame. Every photo is saved untouched, and a copy gets a fixed film look (deep olive-lifted blacks, grain, dust, light leaks). After the party the whole roll "develops" at once and every guest can see everyone's photos. The host curates from a password-protected darkroom.

## How it works

```
phone ──join──▶ /api/session            name, email, consent, opt-outs → httpOnly cookie
phone ──shoot─▶ /api/photos/init        reserves a frame (limit enforced in Postgres) → write-only upload URL
phone ──PUT───▶ Azure  originals/{event}/{guest}/{photo}.jpg    (the file never touches the app server)
phone ──done──▶ /api/photos/complete    → after the response: filter → Azure  filtered/…  → status = done
guests ───────▶ /e/{code}/roll          the shared roll, once the event's release time passes
host ─────────▶ /admin                  star, hide, release the roll, QR code, open originals
```

- **Camera:** the live camera feed in a 1-inch window. Shots are grabbed from the stream in memory and uploaded; nothing is saved to the phone. If camera access is refused, the viewfinder falls back to the phone's camera app.
- **Opt-outs:** when an event allows them, guests can tick "don't use my photos for promotion" and "keep my photos out of the shared roll" (the host still sees them, marked in the darkroom).
- **Themes:** each event has a theme (`base`, `diwali`). A theme is a CSS token set in `app/globals.css` plus copy/decor in `lib/themes.ts`.

## Setup

You need three free-tier accounts: **Supabase** (database), an **Azure storage account** (photos), and **Vercel** (hosting).

1. **Supabase:** create a project. Copy *Project Settings → Database → Connection string → Transaction pooler* (port 6543).
2. **Azure:** use an existing storage account (ADLS Gen2 is fine) or create one (Standard, LRS). Copy the account name and a key from *Security + networking → Access keys*.
3. **Env:** `cp .env.example .env.local` and fill it in.
4. **Create tables, containers and storage CORS** (safe to re-run; keeps any CORS rules you already have):
   ```bash
   npm install
   npm run setup
   ```
5. **Create an event:**
   ```bash
   npm run event -- --code diwali --name "Diwali Carnival × Indo Warehouse" \
     --subtitle "Nov 7 · The Shop · Seattle" --theme diwali --release 2026-11-09T18:00:00-08:00
   ```
   Leave out `--release` to keep the roll held until you release it from `/admin`. Other flags: `--shots 11`, `--no-opt-outs`, `--date-stamp`.
6. **Run it:** `npm run dev`, then open `http://localhost:3000/e/diwali` and `http://localhost:3000/admin`.

### Deploy to Vercel

1. Import `narayave/blindshot` in Vercel. No build settings to change.
2. Add the same env vars as `.env.local`, with `SITE_URL` set to the Vercel URL.
3. Deploy, then run `npm run setup` once more locally with `SITE_URL` set to the deployed URL, so storage CORS allows uploads from it.
4. Open `/admin` and print the QR code.

### Testing on a phone

The camera needs HTTPS. Easiest is a Vercel preview deploy. For your laptop's dev server, use a tunnel (`npx cloudflared tunnel --url http://localhost:3000` or ngrok), and add the tunnel URL to `SITE_URL` and re-run `npm run setup` so uploads are allowed from it.

## Film lab

Tune the film look locally without running the app.

```bash
mkdir -p lab/in && cp ~/some-photos/*.jpg lab/in/   # lab/ is gitignored
npm run lab                                          # writes lab/out/*.jpg
```

Override any option from `DEFAULT_FILM` in [`lib/film.ts`](lib/film.ts) with `lab/options.json`:

```json
{ "contrast": 0.85, "grain": { "amount": 0.1 }, "dateStamp": "2026-10-14" }
```

## Not built yet

Emailed codes to find your roll on another device, a retry queue that survives closing the page, rate limiting, and queue-based processing for big bursts.
