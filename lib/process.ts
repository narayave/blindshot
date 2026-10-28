import { readFile, readdir } from "node:fs/promises";
import exifr from "exifr";
import sharp from "sharp";
import { FILTERED, ORIGINALS, thumbPath } from "./config.ts";
import { sql } from "./db.ts";
import { DEFAULT_FILM, applyFilmFilter } from "./film.ts";
import { download, upload } from "./storage.ts";

// Original in, filtered copy out.
export async function processPhoto(photoId: string): Promise<void> {
  const [p] = await sql<{ original_path: string; shot_number: number; max_shots: number; date_stamp: boolean; overlays: boolean; captured_at: Date | null }[]>`
    select p.original_path, p.shot_number, e.max_shots, e.date_stamp, e.overlays, p.captured_at
    from photos p join events e on e.id = p.event_id where p.id = ${photoId}`;
  if (!p) return;
  try {
    const original = await download(ORIGINALS, p.original_path);
    const exif = await exifr.parse(original, { gps: true }).catch(() => null);
    // Like a real roll, leaks are most likely on the first and last frames.
    const frame = ((p.shot_number - 1) % p.max_shots) + 1; // within its roll
    const edgeFrame = frame === 1 || frame === p.max_shots;
    const seed = seedOf(photoId);
    const filtered = await applyFilmFilter(original, {
      seed,
      overlay: p.overlays ? await pickOverlay(seed) : null,
      ...(edgeFrame && { leak: { ...DEFAULT_FILM.leak, chance: 0.8 } }),
      dateStamp: p.date_stamp ? (p.captured_at ?? new Date()) : null,
    });
    const filteredPath = p.original_path.replace(/\.[a-z]+$/i, ".jpg");
    // Small copy for grids: ~60 KB instead of ~700 KB, full size only loads when someone opens a frame.
    const thumb = await sharp(filtered).resize(640, 640, { fit: "inside" }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    await Promise.all([
      upload(FILTERED, filteredPath, filtered, "image/jpeg"),
      upload(FILTERED, thumbPath(filteredPath), thumb, "image/jpeg"),
    ]);
    await sql`
      update photos set filtered_path = ${filteredPath}, status = 'done', processed_at = now(), error = null,
        exif = ${exif ? sql.json(JSON.parse(JSON.stringify(exif))) : null}
      where id = ${photoId}`;
  } catch (e) {
    // A storage or database blip shouldn't cost a frame: back in the queue (the 2-min claim spaces the tries out),
    // and only after the third try is it 'failed', for the darkroom's Retry button.
    await sql`update photos set status = case when attempts >= 3 then 'failed' else 'uploaded' end,
      error = ${String(e).slice(0, 500)} where id = ${photoId}`;
  }
}

// The website only queues uploads (status 'uploaded'). Filtering runs in the worker (scripts/worker.ts), on another
// machine: on the free Azure host, 100 uploads filtering at once took the whole site down (npm run load).
let busy = false;

// Develop queued photos, oldest first, `lanes` at a time (downloads and uploads overlap the filtering), for about
// budgetMs; returns how many. Safe to run from several processes at once.
export async function develop(budgetMs: number, lanes = 1): Promise<number> {
  if (busy) return 0;
  busy = true;
  const end = Date.now() + budgetMs;
  let n = 0;
  const lane = async () => {
    while (Date.now() < end) {
      // processed_at is the claim while status is still 'uploaded'; a worker that died mid-filter frees it after 2 min.
      const [p] = await sql<{ id: string }[]>`
        update photos set processed_at = now(), attempts = attempts + 1 where id = (
          select id from photos where status = 'uploaded' and (processed_at is null or processed_at < now() - interval '2 minutes')
          order by uploaded_at limit 1 for update skip locked)
        returning id`;
      if (!p) return;
      await processPhoto(p.id);
      n++;
    }
  };
  try {
    await Promise.all(Array.from({ length: lanes }, lane));
  } finally {
    busy = false;
  }
  return n;
}

// On events with overlays on, some frames get an image from overlays/<kind>/ (licensed packs, so never in git:
// npm run overlays). Out of every 60 frames: 5 get a film artifact (~1 in 12), 6 a softer film burn (~1 in 10),
// never both. A missing folder just means no overlays of that kind.
const KINDS = [
  { kind: "artifacts", slots: 5, strength: 1 },
  { kind: "burns", slots: 6, strength: 0.5 },
];
const overlayFiles = new Map<string, Promise<Buffer[]>>();
async function pickOverlay(seed: number): Promise<{ image: Buffer; strength: number } | null> {
  let slot = (seed >>> 0) % 60;
  const k = KINDS.find((k) => (slot -= k.slots) < 0);
  if (!k) return null;
  if (!overlayFiles.has(k.kind)) {
    const dir = new URL(`../overlays/${k.kind}/`, import.meta.url);
    overlayFiles.set(k.kind, readdir(dir)
      .then((fs) => Promise.all(fs.filter((f) => /\.jpe?g$/i.test(f)).sort().map((f) => readFile(new URL(f, dir)))))
      .catch(() => []));
  }
  const all = await overlayFiles.get(k.kind)!;
  return all.length ? { image: all[(seed >>> 8) % all.length], strength: k.strength } : null;
}

const seedOf = (id: string) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
