// The worker on Azure Functions: every minute, develop the queue for up to 50 s, 3 photos at a time.
// Timer runs never overlap, and each run starts fresh, so a crashed run is just picked up by the next one.
// Deploy: scripts/deploy-worker.sh
import { app } from "@azure/functions";
import { develop } from "../lib/process.ts";

app.timer("develop", {
  schedule: "0 * * * * *",
  handler: async (_timer, ctx) => {
    const n = await develop(50_000, 3);
    if (n) ctx.log(`developed ${n}`);
  },
});
