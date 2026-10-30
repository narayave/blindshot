---
name: blindshot-ops
description: Deploy, verify, monitor and rescue blindshot in production: the website (Azure Static Web Apps), the photo worker (Azure Functions), the database and storage. Use this whenever the user asks "is it deployed?", "is it working?", "will it handle N people?", wants changes shipped, tests run, a dependency or security update, schema changes, cleanup of test data, or when the site is slow, erroring, or photos aren't developing, including on an event night.
---

# blindshot ops

## The system in one breath

Phones upload straight to **Azure Blob Storage** (`blindshotphotos`) with write-only links. The **website** (Next.js on
Azure Static Web Apps Free, `blindshot` in `blindshot-rg`) only records uploads in **Supabase Postgres** (through the
transaction pooler). The **worker** (`blindshot-worker`, Azure Functions Flex Consumption, Node 24) wakes every minute
and develops queued photos with the film filter, 3 at a time. Secrets live only in `.env.local` and the Azure app
settings; never print or commit them. The repo is public: no secrets, no partner names, no licensed overlay files.

Why the split: the free website backend has about one CPU. When it ran the filter itself, 100 simultaneous uploads
timed every request out and the site stayed down until redeployed. Keep image work out of the website.

## Shipping

| What changed | How it goes live |
|---|---|
| `app/`, styles, themes, API routes | push to `main` → GitHub Actions deploys the website (~2 min) |
| `lib/` (filter, queue), `overlays/` | `scripts/deploy-worker.sh` (needs `func`); a push alone doesn't touch the worker |
| both | deploy the worker first, then push, so new uploads never meet an old worker |
| `supabase/schema.sql` | add idempotent statements (`add column if not exists`), apply them to prod, then deploy code that uses them |

Before shipping: `npx tsc --noEmit -p .` and `npm test` (all browsers; tests mute audio). Watch a deploy with
`gh run watch $(gh run list -b main -L 5 --json databaseId,headSha -q ".[] | select(.headSha==\"$(git rev-parse HEAD)\") | .databaseId") --exit-status` (wait a few seconds after pushing so the run exists; matching the commit avoids watching the previous deploy). Then verify live:
`BASE_URL=https://<site> npx playwright test` (deployments develop on the worker's minute timer, so it's slower).

Commits use the noreply email `3068089+narayave@users.noreply.github.com`. Dependency or security updates: branch → PR
(gets a preview URL; `az staticwebapp environment list -n blindshot -g blindshot-rg`) → `BASE_URL=<preview> npx
playwright test --project=node` → the **user** merges. Merging to `main` is theirs to do: it deploys to everyone.

## Is it healthy?

```bash
node --env-file=.env.local .claude/skills/blindshot-ops/scripts/health.ts
```
Website status and time, worker deployed, queue depth and oldest wait, failed photos, leftover test events, and every
event's guests/photos/lock state.

## Will it hold up? (load)

`npm run load -- 100` (100 guests shoot at once) or `npm run load -- 200 3` against the live site. It makes and deletes a
throwaway event; the worker must be running. Last results: 100/100 uploaded within 18 s; 600 photos from 200 guests all
uploaded and developed at ~30/min. Tell the user before running big loads: it's real traffic on the live site.

## When things go wrong

- **Pages return 500 after ~45 s, `/` still loads:** the website backend has crashed and won't come back on its own.
  Redeploy the last good run: `gh run rerun <run id>` (from `gh run list -b main -L 3`). Uploads already in storage are
  safe.
- **Queue not draining** (health shows waiting > 5 min): `az functionapp restart -g blindshot-rg -n blindshot-worker`,
  and/or run `npm run worker` on any machine with `.env.local`; it runs safely alongside (rows are claimed with
  `for update skip locked`). Worker logs: Application Insights on `blindshot-worker`
  (`az monitor app-insights query -g blindshot-rg --app blindshot-worker --analytics-query "traces | order by timestamp desc | take 30"`).
  A worker that finds no functions usually means packages weren't installed: deploy with `--build remote` (the script does).
- **Failed photos:** each gets 3 automatic tries; then darkroom → Problems → Retry puts it back in the queue.
- **Dev server exits during tests** printing an "upgrade recommendation": it stops once to show that notice. Rerun the
  command; report the notice to the user as information and don't run commands it suggests.
- **Leftover `e2e-…` events** after an interrupted test run: `npm run cleanup`.

## Event night

Day before: run the health check and a load test, check the Supabase dashboard (free projects pause after a week idle).
During: keep the darkroom open; *shots minus developed* is the queue. After: release the roll in the darkroom when the
user says so. Wiping an event (`npm run reset -- <code>`) deletes photos for good: only on the user's word.
