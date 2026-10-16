// Start an event's roll over: deletes every photo (originals, filtered copies, thumbnails) and every guest,
// so phones that joined get a fresh roll. The event itself and its link stay.
//   npm run reset -- diwali              → wipe the roll
//   npm run reset -- diwali --shots 6    → wipe it and change the roll size
import { parseArgs } from "node:util";
import { FILTERED, ORIGINALS } from "../lib/config.ts";
import { getEvent, sql } from "../lib/db.ts";
import { storageClient } from "../lib/storage.ts";

const { values: v, positionals: [code] } = parseArgs({ allowPositionals: true, options: { shots: { type: "string" } } });
const event = code ? await getEvent(code) : null;
if (!event) { console.error(`No event "${code ?? ""}". Usage: npm run reset -- <code> [--shots 6]`); process.exit(1); }
const shots = v.shots ? Number(v.shots) : event.max_shots;
if (!Number.isInteger(shots) || shots < 1) { console.error("--shots must be a whole number"); process.exit(1); }

const { svc } = storageClient();
let files = 0;
for (const c of [ORIGINALS, FILTERED]) {
  const box = svc.getContainerClient(c);
  for await (const b of box.listBlobsFlat({ prefix: `${event.id}/` })) { await box.deleteBlob(b.name); files++; }
}
const p = await sql`delete from photos where event_id = ${event.id}`;
const s = await sql`delete from sessions where event_id = ${event.id}`; // their cookies stop matching: phones re-join with a fresh roll
await sql`update events set max_shots = ${shots} where id = ${event.id}`;
console.log(`${event.code}: deleted ${p.count} photos (${files} files) and ${s.count} guests; roll is ${shots} shots`);
await sql.end();
