// Delete leftover throwaway test events (code e2e-*), with their guests, photos and files. Tests drop their own
// events, but a run that dies midway (dev server exits, Ctrl-C) leaves them behind.   npm run cleanup
import { dropEvent, sql } from "../e2e/support.ts";

const left = await sql<{ id: string; code: string }[]>`select id, code from events where code like 'e2e-%'`;
for (const e of left) await dropEvent(e);
console.log(left.length ? `deleted ${left.map((e) => e.code).join(", ")}` : "no leftover test events");
await sql.end();
