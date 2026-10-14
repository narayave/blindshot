# blindshot

*a disposable camera for your party*

Guests scan a QR code, open the site on their phone and shoot like a disposable camera: a limited number of shots, and no preview. Every photo is saved untouched, and a copy gets an analog film look (grain, olive shadows, harsh flash, halation). The host curates the results afterwards.

**Status:** early. The film filter works; the camera, upload and admin flows are next.

## Film lab

Tune the film look locally without running the app.

```bash
npm install
mkdir -p lab/in && cp ~/some-photos/*.jpg lab/in/   # lab/ is gitignored
npm run lab                                          # writes lab/out/*.jpg
```

Override any option from `DEFAULT_FILM` in [`lib/film.ts`](lib/film.ts) with `lab/options.json`:

```json
{ "contrast": 0.85, "grain": { "amount": 0.1 }, "dateStamp": "2026-10-14" }
```

## Stack

Next.js on Vercel, Supabase Postgres for metadata, Azure Data Lake Storage Gen2 for images, `sharp` for processing.
