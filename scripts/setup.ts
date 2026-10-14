// One-time setup, safe to re-run: database tables, the two storage containers, and storage CORS
// so phones can upload straight to Azure.   npm run setup
import { readFile } from "node:fs/promises";
import { FILTERED, ORIGINALS } from "../lib/config.ts";
import { sql } from "../lib/db.ts";
import { storageClient } from "../lib/storage.ts";

await sql.unsafe(await readFile("supabase/schema.sql", "utf8"));
console.log("database: tables ready");

const { svc } = storageClient();
for (const c of [ORIGINALS, FILTERED]) {
  await svc.getContainerClient(c).createIfNotExists();
  console.log(`storage: container "${c}" ready`);
}

// Add our CORS rule next to whatever rules the account already has.
const origins = [...new Set([process.env.SITE_URL, "http://localhost:3000"].filter(Boolean))].join(",");
const { cors = [] } = await svc.getProperties();
if (!cors.some((r) => r.allowedOrigins === origins)) {
  cors.push({ allowedOrigins: origins, allowedMethods: "PUT,GET,HEAD,OPTIONS", allowedHeaders: "*", exposedHeaders: "*", maxAgeInSeconds: 3600 });
  await svc.setProperties({ cors });
}
console.log(`storage: CORS allows ${origins}`);
await sql.end();
