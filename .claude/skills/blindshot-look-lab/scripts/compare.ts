// Render a labelled comparison sheet: one row per photo, one column per film-filter variant.
//   node .claude/skills/blindshot-look-lab/scripts/compare.ts <out.jpg> <columns.json> [--photos lab/in] [--size 480]
// columns.json: [{ "label": "Today", "options": {} }, { "label": "Pan", "options": { "pan": { "chance": 1 } }, "seed": 7 }]
// options are FilmOptions overrides (lib/film.ts). Nested objects merge into the defaults, so { "pan": { "chance": 1 } }
// is enough. An overlay is given by file: { "overlay": { "file": "overlays/burns/58.jpg", "strength": 0.5 } }.
// The random extras (leak, shake, pan) are off unless a column turns them on, so every column differs only by what
// it sets. Change "seed" to see the same variant drawn differently (placement, direction, length).
import { readFile, readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import sharp, { type OverlayOptions } from "sharp";
import { applyFilmFilter, type FilmOptions } from "../../../../lib/film.ts";

const { values: v, positionals: [out, spec] } = parseArgs({ allowPositionals: true, options: { photos: { type: "string", default: "lab/in" }, size: { type: "string", default: "480" } } });
if (!out || !spec) { console.error("Usage: compare.ts <out.jpg> <columns.json> [--photos dir] [--size px]"); process.exit(1); }
type Col = { label: string; options?: Record<string, unknown>; seed?: number };
const cols: Col[] = JSON.parse(await readFile(spec, "utf8"));
const calm = { leak: { chance: 0 }, shake: { chance: 0 }, pan: { chance: 0 } };
const optionsFor = async (c: Col) => {
  const o: Record<string, unknown> = { ...calm };
  for (const [k, val] of Object.entries(c.options ?? {})) o[k] = val && typeof val === "object" && k in calm ? { ...(calm as Record<string, object>)[k], ...val } : val;
  const ov = o.overlay as { file?: string; strength?: number } | undefined;
  if (ov?.file) o.overlay = { image: await readFile(ov.file), strength: ov.strength ?? 1 };
  if (typeof o.dateStamp === "string") o.dateStamp = new Date(o.dateStamp);
  return o as Partial<FilmOptions>;
};
const opts = await Promise.all(cols.map(optionsFor));
const photos = (await readdir(v.photos!)).filter((f) => /\.(jpe?g|png|heic)$/i.test(f)).sort();
if (!photos.length) { console.error(`No photos in ${v.photos}. Put a few real party photos there (it's gitignored).`); process.exit(1); }

const T = Number(v.size), top = 52, tiles: OverlayOptions[] = [];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
for (const [c, col] of cols.entries())
  tiles.push({ input: Buffer.from(`<svg width="${T}" height="${top}"><text x="${T / 2}" y="35" text-anchor="middle" font-family="Helvetica" font-size="${Math.min(24, T / 18)}" fill="#eee">${esc(col.label)}</text></svg>`), left: c * T, top: 0 });
for (const [r, p] of photos.entries()) {
  const src = await readFile(`${v.photos}/${p}`);
  const outs = await Promise.all(cols.map((col, c) => applyFilmFilter(src, { seed: (col.seed ?? 1) * 1000 + r, ...opts[c] })));
  for (const [c, b] of outs.entries()) tiles.push({ input: await sharp(b).resize(T, T, { fit: "cover" }).toBuffer(), left: c * T, top: top + r * T });
}
await sharp({ create: { width: cols.length * T, height: top + photos.length * T, channels: 3, background: "#1b1b1b" } })
  .composite(tiles).jpeg({ quality: 88 }).toFile(out);
console.log(`${out}: ${photos.length} photos × ${cols.length} columns`);
