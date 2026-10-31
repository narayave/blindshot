// Pull a spread of an event's untouched originals into a local folder, to test looks on real photos from the night.
//   node --env-file=.env.local .claude/skills/blindshot-look-lab/scripts/sample-event.ts <code> [n=10] [dir=lab/in-<code>]
// Evenly spaced through the night (not random), so the sample covers early, peak and late, light and dark.
// The folder is under lab/ (gitignored): guests' photos never go into the repo.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { ORIGINALS } from "../../../../lib/config.ts";
import { sql } from "../../../../lib/db.ts";
import { download } from "../../../../lib/storage.ts";

const [code, n = "10", dir = `lab/in-${code}`] = process.argv.slice(2);
if (!code) { console.error("Usage: sample-event.ts <code> [n] [dir]"); process.exit(1); }
const rows = await sql<{ original_path: string; shot_number: number; name: string }[]>`
  select p.original_path, p.shot_number, s.name from photos p join events e on e.id = p.event_id join sessions s on s.id = p.session_id
  where e.code = ${code} and p.status = 'done' order by p.captured_at`;
const want = Math.min(Number(n), rows.length);
const picks = Array.from({ length: want }, (_, i) => rows[Math.floor((i * rows.length) / want)]);
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
for (const [i, r] of picks.entries()) {
  const ext = r.original_path.split(".").pop();
  await writeFile(`${dir}/${String(i + 1).padStart(2, "0")}.${ext}`, await download(ORIGINALS, r.original_path));
}
console.log(`${want} of ${rows.length} originals → ${dir}`);
await sql.end();
