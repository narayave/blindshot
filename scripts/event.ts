// Create or update an event (matched by --code). Times are Pacific unless they carry an offset.
//   npm run event -- --code halloween --name "Halloween Night" --subtitle "Sat Oct 31" --theme halloween \
//     --shots 9 --overlays --opens "2026-10-31 18:00"
// With --opens the event switches itself on at that time, shooting stops at 2am the next morning (--closes) and the
// roll is released at 8am (--release); pass any of them to override. Without --opens a new event starts off (guests get
// a 404) until the host switches it on at /e/admin, and nothing closes or releases by itself unless you pass the time.
// Options: --shots 13, --no-opt-outs (hide the opt-out boxes at join), --date-stamp (LED date on photos),
//   --overlays (film-artifact overlays and burns on some frames; see scripts/overlays.ts),
//   --look night (a named look from LOOKS in lib/film.ts; leave out for the default),
//   --credit "@brand" (the same watermark on every photo; leave out to credit whoever took each one).
// This is a full update: every option you leave out goes back to its default. Pass them all again on a re-run.
import { parseArgs } from "node:util";
import { MAX_SHOTS } from "../lib/config.ts";
import { sql } from "../lib/db.ts";
import { LOOKS } from "../lib/film.ts";

const { values: v } = parseArgs({
  options: {
    code: { type: "string" }, name: { type: "string" }, subtitle: { type: "string" }, theme: { type: "string", default: "base" },
    opens: { type: "string" }, closes: { type: "string" }, release: { type: "string" }, shots: { type: "string" },
    "no-opt-outs": { type: "boolean" }, "date-stamp": { type: "boolean" }, overlays: { type: "boolean" }, look: { type: "string" }, credit: { type: "string" },
  },
});
const fail = (m: string) => { console.error(m); process.exit(1); };
if (v.code === "admin") fail('"admin" is taken: /e/admin is the host\'s events page.');
if (!v.code || !/^[a-z0-9-]{2,40}$/.test(v.code) || !v.name) fail("Need --code (lowercase letters, digits, dashes) and --name.");

// Pacific wall-clock time → instant, right across daylight-saving changes (2am on Nov 1 2026 is after the fall-back).
const TZ = "America/Los_Angeles";
function pacific(y: number, mo: number, d: number, h: number, mi = 0): Date {
  for (const off of [7, 8]) {
    const t = new Date(Date.UTC(y, mo - 1, d, h + off, mi));
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", day: "numeric", hour: "numeric" }).formatToParts(t).map((x) => [x.type, x.value]));
    if (Number(p.hour) === h && Number(p.day) === d) return t;
  }
  return fail(`No ${h}:00 on ${y}-${mo}-${d} in Pacific time`) as never;
}
function when(s: string | undefined, flag: string): Date | null {
  if (!s) return null;
  const local = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  const t = local ? pacific(+local[1], +local[2], +local[3], +local[4], +local[5]) : new Date(s);
  return isNaN(t.getTime()) ? fail(`--${flag} must look like "2026-10-31 18:00" (Pacific) or carry an offset`) as never : t;
}
// The next morning at hh:00 Pacific, after an opening time.
function nextMorning(opens: Date, h: number): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(opens).map((x) => [x.type, x.value]));
  const next = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1));
  return pacific(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), h);
}

if (v.look && !(v.look in LOOKS)) fail(`--look must be one of: ${Object.keys(LOOKS).join(", ")}`);
const opens = when(v.opens, "opens");
const closes = when(v.closes, "closes") ?? (opens && nextMorning(opens, 2));
const release = when(v.release, "release") ?? (opens && nextMorning(opens, 8));
if (opens && closes && closes <= opens) fail("--closes must be after --opens");
if (closes && release && release < closes) console.warn("note: the roll is released before shooting stops");

const [e] = await sql<{ code: string; name: string; max_shots: number; online: boolean; opens_at: Date | null; closes_at: Date | null; release_at: Date | null }[]>`
  insert into events (code, name, subtitle, theme, max_shots, opens_at, closes_at, release_at, allow_opt_outs, date_stamp, overlays, look, credit, online)
  values (${v.code!}, ${v.name!}, ${v.subtitle ?? null}, ${v.theme!}, ${Number(v.shots ?? MAX_SHOTS)}, ${opens}, ${closes}, ${release},
          ${!v["no-opt-outs"]}, ${!!v["date-stamp"]}, ${!!v.overlays}, ${v.look ?? null}, ${v.credit ?? null}, ${!!opens})
  on conflict (code) do update set name = excluded.name, subtitle = excluded.subtitle, theme = excluded.theme,
    max_shots = excluded.max_shots, opens_at = excluded.opens_at, closes_at = excluded.closes_at, release_at = excluded.release_at,
    allow_opt_outs = excluded.allow_opt_outs, date_stamp = excluded.date_stamp, overlays = excluded.overlays, look = excluded.look, credit = excluded.credit,
    online = events.online or excluded.online -- a schedule switches it on; without one, keep the host's switch
  returning code, name, max_shots, online, opens_at, closes_at, release_at`;
const pt = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : "—");
console.log(`${e.code}: "${e.name}", ${e.max_shots} shots per roll`);
console.log(`  switch ${e.online ? "on" : "off (switch it on at /e/admin)"} · opens ${pt(e.opens_at)} · shooting stops ${pt(e.closes_at)} · roll released ${e.release_at ? pt(e.release_at) : "when the host releases it"}`);
console.log(`guests join at ${process.env.SITE_URL ?? "http://localhost:3000"}/e/${e.code}`);
await sql.end();
