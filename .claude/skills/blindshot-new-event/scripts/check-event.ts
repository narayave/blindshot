// Check an event on a live site the way a guest meets it, then tidy up after itself.
//   node --env-file=.env.local .claude/skills/blindshot-new-event/scripts/check-event.ts <code> [--base https://…]
// Prints the event's settings, loads its camera page, joins as a throwaway guest, confirms the roll is locked (or
// released, if the event says so) for that guest, and deletes the throwaway guest. Exit code 1 if anything is off.
import { parseArgs } from "node:util";
import { getEvent, isOpen, isReleased, sql } from "../../../../lib/db.ts";

const { values, positionals: [code] } = parseArgs({ allowPositionals: true, options: { base: { type: "string" } } });
const base = (values.base ?? process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const event = code ? await getEvent(code) : null;
if (!event) { console.error(`No event "${code ?? ""}".`); process.exit(1); }

const problems: string[] = [];
const ok = (good: boolean, what: string) => { console.log(`${good ? "✓" : "✗"} ${what}`); if (!good) problems.push(what); };
const released = isReleased(event);
console.log(`${event.code}: "${event.name}"${event.subtitle ? ` · ${event.subtitle}` : ""}`);
const pt = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : "—");
console.log(`  opens ${pt(event.opens_at)} · shooting stops ${pt(event.closes_at)} · release ${pt(event.release_at)}`);
console.log(`  theme ${event.theme} · ${event.max_shots} shots per roll (new rolls always on) · overlays ${event.overlays ? "on" : "off"} · roll ${released ? "RELEASED" : event.release_at ? `locked until ${event.release_at.toISOString()}` : "locked until the host releases it"}`);

const reachable = isOpen(event);
console.log(`  event is ${reachable ? "OPEN (guests can reach it)" : event.online ? "SCHEDULED (guests get a 404 until it opens)" : "OFF (guests get a 404; switch it on at /e/admin)"}`);
const page = await fetch(`${base}/e/${event.code}`);
const html = await page.text();
if (!reachable) {
  ok(page.status === 404 && !html.includes(event.name), `guest link is a dead end (${page.status}) and doesn't reveal the name`);
  await sql.end();
  console.log(`\nhost:    ${base}/e/admin  (switch the event on there when it's time)`);
  process.exit(problems.length ? 1 : 0);
}
ok(page.status === 200, `camera page loads (${page.status})`);
ok(html.includes(`theme-${event.theme}`), `page uses the ${event.theme} theme (unknown theme names fall back to base)`);

const name = `check-${Date.now()}`;
const join = await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventCode: event.code, name, consent: true }) });
ok(join.ok, `a guest can join (${join.status})`);
const cookie = join.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
try {
  const roll = await (await fetch(`${base}/e/${event.code}/roll`, { headers: { cookie } })).text();
  const frames = (roll.match(/class="frame"/g) ?? []).length;
  if (released) ok(!/developing\./.test(roll), `roll is open to guests (${frames} frames showing)`);
  else ok(/developing\./.test(roll) && frames === 0, `roll is locked for guests ("Still developing", ${frames} frames showing)`);
  const cam = await (await fetch(`${base}/e/${event.code}`, { headers: { cookie } })).text();
  ok(cam.includes(`/e/${event.code}/roll`) === released, `camera page ${released ? "links" : "doesn't link"} to the roll`);
} finally {
  await sql`delete from sessions where event_id = ${event.id} and name = ${name}`; // the throwaway guest
  await sql.end();
}
console.log(`\nguests:  ${base}/e/${event.code}\nhost:    ${base}/admin?event=${event.code}  (darkroom: QR code, photos, release)`);
if (problems.length) process.exit(1);
