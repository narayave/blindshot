// Create or update an event (matched by --code).
//   npm run event -- --code diwali --name "Diwali Carnival × Indo Warehouse" --subtitle "Nov 7 · The Shop · Seattle" \
//     --theme diwali --release 2026-11-09T18:00:00-08:00
// Options: --shots 13, --no-opt-outs (hide the opt-out boxes at join), --date-stamp (LED date on photos).
// Leave out --release to hold the shared roll until you release it from /admin.
import { parseArgs } from "node:util";
import { MAX_SHOTS } from "../lib/config.ts";
import { sql } from "../lib/db.ts";

const { values: v } = parseArgs({
  options: {
    code: { type: "string" }, name: { type: "string" }, subtitle: { type: "string" }, theme: { type: "string", default: "base" },
    release: { type: "string" }, shots: { type: "string" }, "no-opt-outs": { type: "boolean" }, "date-stamp": { type: "boolean" },
  },
});
if (!v.code || !/^[a-z0-9-]{2,40}$/.test(v.code) || !v.name) {
  console.error("Need --code (lowercase letters, digits, dashes) and --name.");
  process.exit(1);
}
const release = v.release ? new Date(v.release) : null;
if (release && isNaN(release.getTime())) { console.error("--release must be a date like 2026-11-09T18:00:00-08:00"); process.exit(1); }

const [e] = await sql`
  insert into events (code, name, subtitle, theme, max_shots, release_at, allow_opt_outs, date_stamp)
  values (${v.code}, ${v.name}, ${v.subtitle ?? null}, ${v.theme!}, ${Number(v.shots ?? MAX_SHOTS)}, ${release},
          ${!v["no-opt-outs"]}, ${!!v["date-stamp"]})
  on conflict (code) do update set name = excluded.name, subtitle = excluded.subtitle, theme = excluded.theme,
    max_shots = excluded.max_shots, release_at = excluded.release_at, allow_opt_outs = excluded.allow_opt_outs, date_stamp = excluded.date_stamp
  returning code, name, theme, max_shots, release_at`;
console.log("event saved:", e);
console.log(`guests join at ${process.env.SITE_URL ?? "http://localhost:3000"}/e/${e.code}`);
await sql.end();
