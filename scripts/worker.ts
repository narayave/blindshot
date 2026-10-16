// The darkroom: develops uploaded photos with the film filter, oldest first, until stopped.
// Runs anywhere with the .env.local settings, but not on the website's own server (see lib/process.ts).
//   npm run worker
import { develop } from "../lib/process.ts";
import { sql } from "../lib/db.ts";

let stop = false;
process.on("SIGINT", () => { stop = true; });
process.on("SIGTERM", () => { stop = true; });
console.log("worker: developing uploads (Ctrl-C to stop)");
while (!stop) {
  const t = Date.now();
  const n = await develop(30_000, 3).catch((e) => (console.error("worker:", e), 0));
  if (n) console.log(`worker: developed ${n} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  else await new Promise((r) => setTimeout(r, 2_000));
}
await sql.end();
