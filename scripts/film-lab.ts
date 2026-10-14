// Run the film filter over a folder of photos to tune the look without running the app.
//   npm run lab                 -> lab/in/* -> lab/out/*.jpg
//   npm run lab -- some/folder  -> some/folder/* -> lab/out/*.jpg
// Override any option in lab/options.json, e.g. { "contrast": 0.7, "grain": { "amount": 0.1 } }
// Set "dateStamp": "2026-10-14" there to preview the stamp, or "preset": "dirtyFlash" to start from a named look.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { applyFilmFilter, PRESETS, type FilmOptions } from "../lib/film.ts";

const inDir = process.argv[2] ?? "lab/in";
const outDir = "lab/out";

let options: Partial<FilmOptions> & { preset?: string } = {};
try {
  options = JSON.parse(await readFile("lab/options.json", "utf8"));
  if (typeof options.dateStamp === "string") options.dateStamp = new Date(`${options.dateStamp}T00:00`); // local midnight, not UTC
  if (options.preset) options = { ...PRESETS[options.preset], ...options };
  console.log("options:", JSON.stringify(options));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

await mkdir(outDir, { recursive: true });
const files = (await readdir(inDir)).filter((f) => /\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(f));
if (!files.length) console.log(`No images in ${inDir}. Drop some phone photos there.`);

for (const f of files) {
  const t0 = performance.now();
  const seed = options.seed ?? [...f].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7); // per-photo leaks/dust
  const out = await applyFilmFilter(await readFile(path.join(inDir, f)), { ...options, seed });
  const dest = path.join(outDir, path.parse(f).name + ".jpg");
  await writeFile(dest, out);
  console.log(`${dest}  ${Math.round(performance.now() - t0)}ms`);
}
