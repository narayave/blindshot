// Copy chosen images from a licensed overlay pack into overlays/<kind>/ (gitignored: never commit or share them),
// flattened on black and shrunk to 2400 px so the worker loads them fast. Kinds and how often they appear on events
// with overlays switched on (npm run event -- … --overlays) are in lib/process.ts.
//   npm run overlays -- artifacts "<pack folder>" 08 17
//   npm run overlays -- burns "<pack folder>" 01 15 47 58
import { mkdir, readdir, rm } from "node:fs/promises";
import sharp from "sharp";

const [kind, dir, ...picks] = process.argv.slice(2);
if (!["artifacts", "burns"].includes(kind) || !dir || !picks.length) { console.error('Usage: npm run overlays -- artifacts|burns "<pack folder>" 08 17 …'); process.exit(1); }
const files = await readdir(dir);
const out = `overlays/${kind}`;
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const n of picks) {
  const f = files.find((f) => /\.(png|jpe?g)$/i.test(f) && Number(f.match(/(\d+)\.\w+$/)?.[1]) === Number(n));
  if (!f) { console.error(`no file numbered ${n} in ${dir}`); process.exit(1); }
  await sharp(`${dir}/${f}`).flatten({ background: "#000" }).resize(2400, 2400, { fit: "inside" }).jpeg({ quality: 90 }).toFile(`${out}/${n}.jpg`);
  console.log(`${out}/${n}.jpg ← ${f}`);
}
