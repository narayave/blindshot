// Party-rush test: N guests join a throwaway event, then all press the shutter at the same moment.
// Each upload follows the phone's own path (init → PUT to blob → complete, retrying with backoff like CameraApp),
// then it waits for the worker to develop them all. Start a worker first (npm run worker) or nothing develops.
//   npm run load                  → 100 guests against BASE_URL (default: the live site)
//   npm run load -- 200 2         → 200 guests, 2 shots each
// The event, its rows and its blobs are deleted afterwards.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { dropEvent, makeEvent, photos } from "../e2e/support.ts";
import { sql } from "../lib/db.ts";

const BASE = process.env.BASE_URL ?? "https://blindshot.thewestcasechapters.com";
const GUESTS = Number(process.argv[2] ?? 100);
const SHOTS = Number(process.argv[3] ?? 1);

// A photo the size phones actually send (2400px edge, JPEG 0.92), with noise so it doesn't compress to nothing.
const W = 2400, H = 1800;
const noise = Buffer.alloc(W * H * 3);
for (let i = 0; i < noise.length; i++) noise[i] = 90 + Math.random() * 80;
const jpeg = await sharp(noise, { raw: { width: W, height: H, channels: 3 } }).blur(1.2).jpeg({ quality: 92 }).toBuffer();

const t = () => performance.now();
const stats: Record<string, number[]> = { join: [], init: [], put: [], complete: [], uploaded: [] };
const errors: Record<string, number> = {};
const fail = (what: string) => { errors[what] = (errors[what] ?? 0) + 1; };

async function timed<T>(stage: string, f: () => Promise<T>) {
  const s = t();
  try { return await f(); } finally { stats[stage].push(t() - s); }
}

async function join(code: string, i: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await timed("join", () => fetch(`${BASE}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventCode: code, name: `Load${i}`, email: `load${i}@example.com`, consent: true }),
    })).catch(() => null);
    if (r?.ok) return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    fail(`join ${r?.status ?? "network"}`);
    await new Promise((s) => setTimeout(s, 1000 * 2 ** attempt));
  }
  throw new Error(`guest ${i} couldn't join`);
}

async function shoot(code: string, cookie: string) {
  const post = (path: string, body: object) => fetch(`${BASE}${path}`, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body),
  });
  const id = randomUUID(), capturedAt = new Date().toISOString(), start = t();
  for (let attempt = 0; ; attempt++) {
    try {
      const init = await timed("init", () => post("/api/photos/init", { eventCode: code, photoId: id, contentType: "image/jpeg" }));
      if (!init.ok) throw new Error(`init ${init.status}`);
      const { uploadUrl } = await init.json();
      const put = await timed("put", () => fetch(uploadUrl, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "image/jpeg" }, body: jpeg }));
      if (!put.ok) throw new Error(`put ${put.status}`);
      const done = await timed("complete", () => post("/api/photos/complete", { photoId: id, capturedAt, sentAt: new Date().toISOString(), width: W, height: H }));
      if (!done.ok) throw new Error(`complete ${done.status}`);
      stats.uploaded.push(t() - start);
      return attempt;
    } catch (e) {
      fail(e instanceof TypeError ? "network" : (e as Error).message);
      if (t() - start > 5 * 60_000) throw new Error("upload gave up after 5 min");
      await new Promise((s) => setTimeout(s, Math.min(15_000, 1000 * 2 ** attempt)));
    }
  }
}

const pct = (xs: number[], p: number) => xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : NaN;
const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const e = await makeEvent({ shots: SHOTS });
console.log(`${BASE}: ${GUESTS} guests × ${SHOTS} shot(s), ${(jpeg.length / 1e6).toFixed(2)} MB each, event ${e.code}`);
try {
  let w = t();
  const cookies = await Promise.all(Array.from({ length: GUESTS }, (_, i) => join(e.code, i)));
  console.log(`all joined in ${s(t() - w)}`);

  w = t();
  const retries: number[] = [];
  for (let k = 0; k < SHOTS; k++) {
    const r = await Promise.allSettled(cookies.map((c) => shoot(e.code, c)));
    for (const x of r) x.status === "fulfilled" ? retries.push(x.value) : fail(String(x.reason));
  }
  console.log(`all uploads settled in ${s(t() - w)}`);

  // The worker runs elsewhere: watch the database until the queue is empty (or stops moving for 2 min).
  let ps = await photos(e.id), last = -1, still = t();
  for (;;) {
    const n = ps.filter((p) => p.status === "done" || p.status === "failed").length;
    if (n === ps.length) break;
    if (n !== last) { last = n; still = t(); } else if (t() - still > 120_000) { console.log("worker stopped developing"); break; }
    await new Promise((r) => setTimeout(r, 2_000));
    ps = await photos(e.id);
  }
  console.log(`all developed ${s(t() - w)} after the shutter`);
  const done = ps.filter((p) => p.status === "done").length;
  console.log(`\ndeveloped ${done}/${GUESTS * SHOTS}, failed ${ps.filter((p) => p.status === "failed").length}, needed a retry ${retries.filter((n) => n > 0).length}`);
  console.log("stage      n     p50    p90    p99    max");
  for (const [k, v] of Object.entries(stats))
    console.log(`${k.padEnd(9)} ${String(v.length).padStart(4)}  ${[0.5, 0.9, 0.99, 1].map((p) => s(pct(v, p)).padStart(6)).join(" ")}`);
  if (Object.keys(errors).length) console.log("\nerrors (each one retried):", errors);
} finally {
  await dropEvent(e);
  await sql.end();
}
