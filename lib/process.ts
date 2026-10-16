import exifr from "exifr";
import sharp from "sharp";
import { FILTERED, ORIGINALS, thumbPath } from "./config.ts";
import { sql } from "./db.ts";
import { DEFAULT_FILM, applyFilmFilter } from "./film.ts";
import { download, upload } from "./storage.ts";

// Original in, filtered copy out. Kept apart from the route so it can move to a queue/worker later.
export async function processPhoto(photoId: string): Promise<void> {
  const [p] = await sql<{ original_path: string; shot_number: number; max_shots: number; date_stamp: boolean; captured_at: Date | null }[]>`
    select p.original_path, p.shot_number, e.max_shots, e.date_stamp, p.captured_at
    from photos p join events e on e.id = p.event_id where p.id = ${photoId}`;
  if (!p) return;
  try {
    const original = await download(ORIGINALS, p.original_path);
    const exif = await exifr.parse(original, { gps: true }).catch(() => null);
    // Like a real roll, leaks are most likely on the first and last frames.
    const edgeFrame = p.shot_number === 1 || p.shot_number === p.max_shots;
    const filtered = await applyFilmFilter(original, {
      seed: seedOf(photoId),
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
    await sql`update photos set status = 'failed', error = ${String(e).slice(0, 500)} where id = ${photoId}`;
  }
}

// The website only queues uploads (status 'uploaded'). Filtering runs in the worker (scripts/worker.ts), on another
// machine: on the free Azure host, 100 uploads filtering at once took the whole site down (npm run load).
let busy = false;

// Develop queued photos, oldest first, for about budgetMs; returns how many. Safe to run from several processes at once.
export async function develop(budgetMs: number): Promise<number> {
  if (busy) return 0;
  busy = true;
  const end = Date.now() + budgetMs;
  let n = 0;
  try {
    while (Date.now() < end) {
      // processed_at is the claim while status is still 'uploaded'; a server that died mid-filter frees it after 2 min.
      const [p] = await sql<{ id: string }[]>`
        update photos set processed_at = now() where id = (
          select id from photos where status = 'uploaded' and (processed_at is null or processed_at < now() - interval '2 minutes')
          order by uploaded_at limit 1 for update skip locked)
        returning id`;
      if (!p) break;
      await processPhoto(p.id);
      n++;
    }
  } finally {
    busy = false;
  }
  return n;
}

const seedOf = (id: string) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
