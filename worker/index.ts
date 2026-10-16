// The worker on Azure Functions: every minute, develop the queue for up to 50 s.
// Timer runs never overlap, so it's one filter at a time, off the website's server. Deploy: scripts/deploy-worker.sh
import { app } from "@azure/functions";
import { develop } from "../lib/process.ts";

app.timer("develop", {
  schedule: "0 * * * * *",
  handler: async (_timer, ctx) => {
    const n = await develop(50_000);
    if (n) ctx.log(`developed ${n}`);
  },
});
