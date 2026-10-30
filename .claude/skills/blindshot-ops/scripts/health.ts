// One-look health check for a live blindshot: website, worker queue, failures, leftovers.
//   node --env-file=.env.local .claude/skills/blindshot-ops/scripts/health.ts [--base https://…]
// Exit code 1 when something needs attention.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { sql } from "../../../../lib/db.ts";

const { values } = parseArgs({ options: { base: { type: "string" } } });
const base = (values.base ?? process.env.SITE_URL ?? "").replace(/\/$/, "");
const issues: string[] = [];
const line = (good: boolean, what: string) => { console.log(`${good ? "✓" : "✗"} ${what}`); if (!good) issues.push(what); };

if (base) {
  const t = Date.now();
  const r = await fetch(`${base}/e/test`, { signal: AbortSignal.timeout(50_000) }).catch(() => null);
  const s = ((Date.now() - t) / 1000).toFixed(1);
  // A dynamic page answering 500 after ~45 s means the website's backend has died: redeploy (see SKILL.md).
  line(!!r && r.status < 500, `website answers: ${r?.status ?? "no response"} in ${s}s`);
}

try {
  const fns = execFileSync("az", ["functionapp", "function", "list", "-g", "blindshot-rg", "-n", "blindshot-worker", "--query", "[].name", "-o", "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  line(fns.includes("develop"), `worker function deployed (${fns || "none"})`);
} catch {
  console.log("· worker function: couldn't ask Azure (az not logged in?)");
}

const [q] = await sql<{ waiting: number; oldest_min: number | null; failed: number; done_hour: number }[]>`
  select count(*) filter (where status = 'uploaded')::int as waiting,
         extract(epoch from now() - min(uploaded_at) filter (where status = 'uploaded'))::int / 60 as oldest_min,
         count(*) filter (where status = 'failed')::int as failed,
         count(*) filter (where status = 'done' and processed_at > now() - interval '1 hour')::int as done_hour
  from photos`;
// The worker wakes every minute, so anything waiting more than ~5 min means it isn't developing.
line(q.waiting === 0 || (q.oldest_min ?? 0) < 5, `queue: ${q.waiting} waiting${q.waiting ? `, oldest ${q.oldest_min} min` : ""}; ${q.done_hour} developed in the last hour`);
line(q.failed === 0, `failed photos: ${q.failed} (darkroom → Problems → Retry)`);
const [{ n: stuck }] = await sql<{ n: number }[]>`select count(*)::int as n from photos where status = 'pending' and created_at < now() - interval '30 minutes'`;
console.log(`· shots reserved but never uploaded (>30 min): ${stuck}  (normal: phones closed mid-upload or tests)`);
const leftovers = await sql<{ code: string }[]>`select code from events where code like 'e2e-%'`;
line(leftovers.length === 0, `leftover test events: ${leftovers.length}${leftovers.length ? " (npm run cleanup)" : ""}`);
const events = await sql<{ code: string; guests: number; photos: number; released: boolean }[]>`
  select e.code, (select count(*)::int from sessions s where s.event_id = e.id) as guests,
         (select count(*)::int from photos p where p.event_id = e.id) as photos,
         coalesce(e.release_at <= now(), false) as released
  from events e where e.code not like 'e2e-%' order by e.created_at`;
for (const e of events) console.log(`  ${e.code.padEnd(16)} ${String(e.guests).padStart(4)} guests ${String(e.photos).padStart(5)} photos  ${e.released ? "released" : "locked"}`);
await sql.end();
console.log(issues.length ? `\n${issues.length} thing(s) need attention` : "\nall good");
if (issues.length) process.exit(1);
