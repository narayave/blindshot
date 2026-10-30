// Numbered contact sheet of an overlay pack folder, to pick images by number.
//   node .claude/skills/blindshot-look-lab/scripts/pack-sheet.ts "<pack folder>" <out.jpg>
// Transparent areas show magenta, so you can tell a cut-out from an image on black.
import { readdir } from "node:fs/promises";
import sharp, { type OverlayOptions } from "sharp";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('Usage: pack-sheet.ts "<pack folder>" <out.jpg>'); process.exit(1); }
const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
const W = 320, H = 180, cols = 8, tiles: OverlayOptions[] = [];
for (const [i, f] of files.entries()) {
  const left = (i % cols) * W, top = Math.floor(i / cols) * H, n = f.match(/(\d+)\.\w+$/)?.[1] ?? String(i + 1);
  tiles.push({ input: await sharp(`${dir}/${f}`).resize(W, H, { fit: "cover" }).flatten({ background: "#ff00ff" }).toBuffer(), left, top });
  tiles.push({ input: Buffer.from(`<svg width="${W}" height="${H}"><rect width="40" height="22" fill="#000"/><text x="4" y="17" font-size="16" fill="#0f0" font-family="monospace">${n}</text></svg>`), left, top });
}
await sharp({ create: { width: cols * W, height: Math.ceil(files.length / cols) * H, channels: 3, background: "#333" } }).composite(tiles).jpeg({ quality: 80 }).toFile(out);
console.log(`${out}: ${files.length} images`);
