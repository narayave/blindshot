# Cost and price per event

Use this when the user asks what an event costs to run, what to charge, or wants an audit of an event.

## Unit costs (from Azure Cost Management, October 2026, `blindshot-rg`, West US 2)

| Meter | Billed | Unit cost |
|---|---|---|
| Worker compute (Flex Consumption, on-demand execution time) | 41,292 GB-s → $1.07 | $0.000026 per GB-s (no free grant on this subscription) |
| Blob write operations (Hot LRS) | 23,840 ops → $0.12 | $0.05 per 10,000 |
| Blob read operations (Hot) | 4,220 ops → $0.002 | $0.004 per 10,000 |
| Storage (Hot LRS) | 0.075 GB-month → $0.0014 | ~$0.019 per GB per month |
| Data out to the internet | 0.39 GB → $0.034 | ~$0.087 per GB |
| Website (Static Web Apps Free), Supabase (free tier), Cloudflare DNS | | $0 |

Month to date, including ~700 load-test photos and every test run: **$1.41**. About half the worker compute is its
once-a-minute wake-up even when idle (~$0.50–1 per month, whether or not there's an event).

Refresh these numbers (they're the user's real bill, broken down by meter):
```bash
SUB=$(az account show --query id -o tsv)
az rest --method post --url "https://management.azure.com/subscriptions/$SUB/resourceGroups/blindshot-rg/providers/Microsoft.CostManagement/query?api-version=2023-03-01" \
  --body '{"type":"ActualCost","timeframe":"MonthToDate","dataset":{"granularity":"None","aggregation":{"cost":{"name":"PreTaxCost","function":"Sum"},"qty":{"name":"UsageQuantity","function":"Sum"}},"grouping":[{"type":"Dimension","name":"MeterSubcategory"},{"type":"Dimension","name":"Meter"}]}}'
```
(`timeframe` can be `TheLastMonth`, or a custom range with `timePeriod`.) Photo counts per event come from the
`photos` table, or the events page `/e/admin`.

## Cost per photo

| What | Per photo |
|---|---|
| Developing (~2.5 s × 2 GB) | $0.00013 |
| Writes (original, filtered, thumbnail, metadata) | $0.00002 |
| Storage (~1.7 MB: original ~0.9, filtered ~0.7, thumbnail ~0.06) for 90 days | $0.0001 |
| Guests viewing it (thumbnail seen by most guests, full size by some, a few saves) | ~$0.0005–0.001 |
| **Total** | **≈ $0.001 (a tenth of a cent)** |

Data out (guests browsing the roll) is the biggest and most variable part: it grows with guests × photos.

## Cost per event (rough, 13 shots per roll, ~1 roll per guest, everyone browses the roll)

| Guests | Photos | Cost to run |
|---|---|---|
| 50 | ~650 | ~$0.40 |
| 100 | ~1,300 | ~$1.40 |
| 200 | ~2,600 | ~$5 |
| 300 | ~3,900 | ~$11 |

Bigger events cost more per photo because each guest browses a bigger roll. Even 300 guests stays around $10.

## What to charge (a starting point; the user decides)

Anchor: a disposable camera is ~$15–25 plus ~$15–20 to develop and scan, ~27 photos and a week's wait,
so about **$1.20–1.50 per photo**, and only the camera's owner sees the shots.

- **Per photo:** $0.20–0.30 per developed photo. A 100-guest night (~1,300 photos) → **$260–390**, against ~$1.40 to run.
- **Per event, by size:** up to 50 guests $99, up to 150 $199, up to 300 $349; above the allowance $0.15 per photo.
- **Content deal with a host or promoter:** the host gets every original for their channels; price it as a package
  rather than per photo.

Revenue sketch: four 100-guest events a month at $199 → ~$800/month, against ~$6 of Azure (four events plus the idle worker).
Costs that aren't Azure, and aren't counted above: your time on the night, printing the QR code, and any paid overlay
licence (the artifacts pack is personal-use only; a commercial licence is a one-off cost).

For an audit, bill on developed photos (`status = 'done'`), not shots taken: failed or abandoned uploads never cost the
guest anything and cost us almost nothing.
