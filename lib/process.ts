import exifr from "exifr";
import sharp from "sharp";
import { FILTERED, ORIGINALS, thumbPath } from "./config";
import { sql } from "./db";
import { DEFAULT_FILM, applyFilmFilter } from "./film";
import { download, upload } from "./storage";

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

// One filter at a time per server. The free Azure host has about one core: 100 uploads filtering at once
// timed out every request and took the site down (npm run load). So uploads queue as 'uploaded' and develop in order.
let busy = false;

// Develop queued photos, oldest first, for about budgetMs. Returns at once if this server is already at it.
export async function develop(budgetMs: number): Promise<void> {
  if (busy) return;
  busy = true;
  const end = Date.now() + budgetMs;
  try {
    while (Date.now() < end) {
      // processed_at is the claim while status is still 'uploaded'; a server that died mid-filter frees it after 2 min.
      const [p] = await sql<{ id: string }[]>`
        update photos set processed_at = now() where id = (
          select id from photos where status = 'uploaded' and (processed_at is null or processed_at < now() - interval '2 minutes')
          order by uploaded_at limit 1 for update skip locked)
        returning id`;
      if (!p) return;
      await processPhoto(p.id);
    }
  } finally {
    busy = false;
  }
}

export async function queued(eventId: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from photos where event_id = ${eventId} and status = 'uploaded'`;
  return r.n;
}

const seedOf = (id: string) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
