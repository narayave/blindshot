// Throwaway events for tests: created straight in the database, deleted (rows and blobs) afterwards.
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { FILTERED, ORIGINALS } from "../lib/config.ts";
import { sql } from "../lib/db.ts";
import { develop } from "../lib/process.ts";
import { storageClient } from "../lib/storage.ts";

export { sql };

export async function makeEvent(o: { shots?: number; released?: boolean; optOuts?: boolean; focusCheck?: boolean } = {}) {
  const code = `e2e-${randomBytes(4).toString("hex")}`;
  const [e] = await sql<{ id: string; code: string }[]>`
    insert into events (code, name, subtitle, theme, max_shots, release_at, allow_opt_outs, focus_check)
    values (${code}, 'E2E Party', 'automated test', 'diwali', ${o.shots ?? 2},
            ${o.released === false ? null : new Date(Date.now() - 60_000)}, ${o.optOuts ?? true}, ${o.focusCheck ?? false})
    returning id, code`;
  return e;
}

export async function dropEvent(e: { id: string }) {
  const { svc } = storageClient();
  for (const c of [ORIGINALS, FILTERED]) {
    const box = svc.getContainerClient(c);
    for await (const b of box.listBlobsFlat({ prefix: `${e.id}/` })) await box.deleteBlob(b.name);
  }
  await sql`delete from photos where event_id = ${e.id}`;
  await sql`delete from sessions where event_id = ${e.id}`;
  await sql`delete from events where id = ${e.id}`;
}

export async function photos(eventId: string) {
  return sql<{ id: string; status: string; session_id: string; captured_at: Date | null; error: string | null }[]>`
    select id, status, session_id, captured_at, error from photos where event_id = ${eventId} order by shot_number`;
}

// Poll until every photo of the event is filtered (or one fails). Locally the test is the worker;
// against a deployment (BASE_URL) the real worker has to do it.
export async function waitDeveloped(eventId: string, count: number, ms = process.env.BASE_URL ? 150_000 : 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    const ps = await photos(eventId);
    if (ps.some((p) => p.status === "failed")) throw new Error(`processing failed: ${ps.find((p) => p.error)?.error}`);
    if (ps.length === count && ps.every((p) => p.status === "done")) return ps;
    if (Date.now() > end) throw new Error(`developed ${ps.filter((p) => p.status === "done").length}/${count}`);
    if (process.env.BASE_URL || !(await develop(5_000))) await new Promise((r) => setTimeout(r, 1000));
  }
}

// A small synthetic photo, so the repo needs no binary fixtures.
export const testJpeg = (w = 1200, h = 900) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 60 } } })
    .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${h / 3}" fill="#2a6"/></svg>`) }])
    .jpeg()
    .toBuffer();
