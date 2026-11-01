// Export an event's developed photos for posting: re-developed from the originals with the same look and seed, so
// they match the roll exactly, minus the credit in the corner. Instagram-ready 4:5 (1080x1350, cropped from the top so
// the date stamp stays). Only photos you may post: the host's own, plus guests who didn't opt out of promotion or
// keep their roll private. Written to a local folder (never commit it).
//   npm run export -- halloween halloween-fri [--out ~/Desktop/blindshot-posts] [--keep-credit] [--host Vee]
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { ORIGINALS } from "../lib/config.ts";
import { sql } from "../lib/db.ts";
import { developFrame } from "../lib/process.ts";
import { download } from "../lib/storage.ts";

const { values: v, positionals: codes } = parseArgs({ allowPositionals: true, options: {
  out: { type: "string", default: `${homedir()}/Desktop/blindshot-posts` }, "keep-credit": { type: "boolean" }, host: { type: "string", default: "Vee" },
} });
if (!codes.length) { console.error("Usage: npm run export -- <event-code> [more codes] [--out dir]"); process.exit(1); }
// 2026-10-31-214205: to the second, Pacific; several shots can land in the same minute.
const pt = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" }).replace(/[: ]/g, (c) => (c === ":" ? "" : "-"));
for (const code of codes) {
  const rows = await sql<{ id: string; original_path: string; captured_at: Date | null; name: string; host: boolean }[]>`
    select p.id, p.original_path, p.captured_at, s.name, s.name = ${v.host!} as host
    from photos p join events e on e.id = p.event_id join sessions s on s.id = p.session_id
    where e.code = ${code} and p.status = 'done' and not p.hidden and not s.private_roll and not s.no_promo
    order by p.captured_at`;
  for (const who of ["yours", "guests"] as const) {
    const pick = rows.filter((r) => r.host === (who === "yours"));
    if (!pick.length) continue;
    const dir = `${v.out}/${code}/${who}`;
    await mkdir(dir, { recursive: true });
    let n = 0;
    for (const r of pick) {
      const dev = await developFrame(r.id, await download(ORIGINALS, r.original_path), v["keep-credit"] ? {} : { watermark: null });
      const { width = 1, height = 1 } = await sharp(dev).metadata();
      const h45 = Math.round(width * 1.25); // 4:5, Instagram's tallest feed shape
      const cut = height > h45 ? await sharp(dev).extract({ left: 0, top: height - h45, width, height: h45 }).toBuffer() : dev;
      const out = await sharp(cut).resize(1080, 1350, { fit: "cover", position: "south" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      await writeFile(`${dir}/${r.captured_at ? pt(r.captured_at) : "unknown"}-${r.id.slice(0, 4)}${who === "guests" ? `-${r.name.toLowerCase()}` : ""}.jpg`, out);
      n++;
    }
    console.log(`${code}/${who}: ${n} photos`);
  }
}
console.log(`→ ${v.out}`);
await sql.end();
