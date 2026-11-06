// Render the wigglegrams grouped in the darkroom (Wiggles tab) as a looping MP4 (for Instagram) and a GIF.
// Every frame is cropped around the subject the host tapped, colour-matched to the middle frame, then developed with
// ONE seed (same grain, leaks, dust, overlay), motion effects off and one date stamp, so only the viewpoint changes.
// Written to a local folder (never commit it).
//   npm run wiggle -- <event-code | wiggle id> [--speed 0.2] [--keep-credit] [--out ~/Desktop/blindshot-posts/wiggles]
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { ORIGINALS } from "../lib/config.ts";
import { sql } from "../lib/db.ts";
import { DEFAULT_FILM, LOOKS } from "../lib/film.ts";
import { developFrame, seedOf } from "../lib/process.ts";
import { download } from "../lib/storage.ts";
import { wiggleCrop } from "../lib/wiggle.ts";

const { values: v, positionals: [target] } = parseArgs({ allowPositionals: true, options: {
  speed: { type: "string", default: "0.2" }, "keep-credit": { type: "boolean" },
  out: { type: "string", default: `${homedir()}/Desktop/blindshot-posts/wiggles` },
} });
if (!target) { console.error("Usage: npm run wiggle -- <event-code | wiggle id> [--speed 0.2] [--keep-credit]"); process.exit(1); }
const speed = Number(v.speed);
const W = 1600, H = 2000; // developed at roll size (grain matches the roll), shrunk to 1080x1350 at the end

type Row = { id: string; wiggle: string; code: string; look: string | null; date_stamp: boolean; original_path: string; captured_at: Date | null; x: number | null; y: number | null };
const rows = await sql<Row[]>`
  select p.id, p.wiggle::text, e.code, e.look, e.date_stamp, p.original_path, p.captured_at, p.wiggle_x as x, p.wiggle_y as y
  from photos p join events e on e.id = p.event_id
  where p.wiggle is not null and (e.code = ${target} or p.wiggle::text like ${target + "%"})
  order by p.captured_at, p.id`;
const groups = Map.groupBy(rows, (r) => r.wiggle);
if (!groups.size) console.log(`No wiggles for "${target}": group frames in the darkroom's Wiggles tab first.`);

for (const [id, frames] of groups) {
  if (frames.length < 2) { console.log(`${id.slice(0, 8)}: only one frame, skipped`); continue; }
  const originals = await Promise.all(frames.map(async (f) => sharp(await download(ORIGINALS, f.original_path)).rotate().toBuffer()));
  const sizes = await Promise.all(originals.map((b) => sharp(b).metadata()));
  const crops = wiggleCrop(frames.map((f, i) => ({ x: f.x ?? 0.5, y: f.y ?? 0.5, ratio: sizes[i].width! / sizes[i].height! })));
  const cut = await Promise.all(originals.map((b, i) => {
    const { width: w = 1, height: h = 1 } = sizes[i], c = crops[i];
    const box = { left: Math.round(c.left * w), top: Math.round(c.top * h), width: Math.round(c.width * w), height: Math.round(c.height * h) };
    box.width = Math.min(box.width, w - box.left); box.height = Math.min(box.height, h - box.top);
    return sharp(b).extract(box).resize(W, H, { fit: "fill" }).toBuffer();
  }));

  // Phones see colour differently: shift each frame's per-channel mean and spread to the middle frame's.
  const stats = await Promise.all(cut.map((b) => sharp(b).stats()));
  const ref = stats[Math.floor(stats.length / 2)].channels;
  const matched = await Promise.all(cut.map((b, i) => {
    const a = stats[i].channels.slice(0, 3).map((c, k) => Math.min(1.6, Math.max(0.6, ref[k].stdev / (c.stdev || 1))));
    const off = stats[i].channels.slice(0, 3).map((c, k) => ref[k].mean - a[k] * c.mean);
    return sharp(b).linear(a, off).jpeg({ quality: 95 }).toBuffer();
  }));

  const look = { ...DEFAULT_FILM, ...(frames[0].look ? LOOKS[frames[0].look] : undefined) };
  const shared = {
    seed: seedOf(id),
    shake: { ...look.shake, chance: 0 }, pan: { ...look.pan, chance: 0 }, // motion would make the subject jump
    leak: look.leak, // not the roll's "first and last frame" leak bump, which differs per frame
    dateStamp: frames[0].date_stamp ? frames[0].captured_at : null, // one stamp for all frames, if the event has them
    frame: "none" as const, // polaroid cards and strips don't wiggle
    ...(v["keep-credit"] ? {} : { watermark: null }),
  };
  const tmp = await mkdtemp(join(tmpdir(), "wiggle-"));
  const developed: Buffer[] = [];
  for (let i = 0; i < frames.length; i++) {
    const dev = await developFrame(frames[i].id, matched[i], shared);
    developed.push(await sharp(dev).resize(1080, 1350, { fit: "cover" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
  }

  // There and back: 1 2 3 4 3 2 | 1 2 3 ...
  const cycle = [...developed.keys(), ...[...developed.keys()].slice(1, -1).reverse()];
  const dir = `${v.out}/${frames[0].code}-${id.slice(0, 8)}`;
  await mkdir(dir, { recursive: true });
  await Promise.all(developed.map((b, i) => writeFile(`${dir}/frame-${i + 1}.jpg`, b)));
  const seq = async (repeat: number) => {
    let n = 0;
    for (let r = 0; r < repeat; r++) for (const i of cycle) await writeFile(join(tmp, `${String(n++).padStart(4, "0")}.jpg`), developed[i]);
  };
  const ff = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(1 / speed), "-i", join(tmp, "%04d.jpg"), ...args]);
  await seq(1);
  ff("-vf", "scale=720:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0", `${dir}/wiggle.gif`);
  await rm(tmp, { recursive: true }); await mkdir(tmp);
  await seq(Math.max(1, Math.ceil(6 / (cycle.length * speed)))); // Instagram wants a few seconds: loop it to ~6 s
  ff("-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", `${dir}/wiggle.mp4`);
  await rm(tmp, { recursive: true });
  console.log(`${id.slice(0, 8)}: ${frames.length} frames → ${dir}`);
}
await sql.end();
