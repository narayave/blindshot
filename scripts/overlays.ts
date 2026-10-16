// Copy chosen film-artifact images from a licensed pack into overlays/ (gitignored: never commit or share them),
// flattened on black and shrunk to 2400 px so the worker loads them fast. The worker screens one over ~1 in 12 frames
// of events that have overlays switched on (npm run event -- … --overlays).
//   npm run overlays -- "<pack folder>" 38 17 08 48
import { mkdir, readdir, rm } from "node:fs/promises";
import sharp from "sharp";

const [dir, ...picks] = process.argv.slice(2);
if (!dir || !picks.length) { console.error('Usage: npm run overlays -- "<pack folder>" 38 17 …'); process.exit(1); }
const files = await readdir(dir);
await rm("overlays", { recursive: true, force: true });
await mkdir("overlays");
for (const n of picks) {
  const f = files.find((f) => /\.(png|jpe?g)$/i.test(f) && Number(f.match(/(\d+)\.\w+$/)?.[1]) === Number(n));
  if (!f) { console.error(`no file numbered ${n} in ${dir}`); process.exit(1); }
  await sharp(`${dir}/${f}`).flatten({ background: "#000" }).resize(2400, 2400, { fit: "inside" }).jpeg({ quality: 90 }).toFile(`overlays/${n}.jpg`);
  console.log(`overlays/${n}.jpg ← ${f}`);
}
