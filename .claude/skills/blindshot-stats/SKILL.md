---
name: blindshot-stats
description: The numbers behind a blindshot event, and what they teach: funnel and conversion rates (opened the link → signed up → shot), the long tail after the party (album viewers, after-party sign-ins, picks → sign-in conversion), album engagement (photos opened, saves, saves of other people's photos), shooting patterns (photos per person, peak hour, iPhone vs Android) and camera health (permission denied, stuck, not wound). Use this whenever the owner asks for stats, numbers, "how many", conversion, who's viewing the album, how the night went, a debrief, or material for LinkedIn, a resume, a pitch or a case study, even if they only say "give me stats".
---

# blindshot stats

The owner learns the product from these numbers and turns them into a story (LinkedIn, resume, pitches to hosts).
Give numbers first, then what they mean. Keep the learnings file growing so every event adds to the story.

## Run it

```bash
node --env-file=.env.local .claude/skills/blindshot-stats/scripts/stats.ts diwali            # one event
node --env-file=.env.local .claude/skills/blindshot-stats/scripts/stats.ts --compare halloween-fri,halloween,diwali
node --env-file=.env.local .claude/skills/blindshot-stats/scripts/stats.ts diwali --names    # who (local only)
node --env-file=.env.local .claude/skills/blindshot-stats/scripts/stats.ts diwali --json     # for charts
```

For a quick "how many since yesterday / in the last hour" the owner often wants a time slice: query `sessions`
(sign-ups, `created_at`) and `visits` (page loads, `at`) directly, in Pacific time, and say which slice you used.

## What each number means

[references/metrics.md](references/metrics.md) has the definitions (what counts as a viewer, a sign-up "on the night",
a conversion) and the data model. Read it before quoting a rate, so the same word means the same thing every time.

## After every event (and when asked "what are we learning?")

1. Run the report, compare with earlier events (`--compare`).
2. Add a dated section to [references/learnings.md](references/learnings.md): the headline numbers, what changed since
   the last event, and the 2-4 lessons the numbers support (with the number next to each). Update the "resume / LinkedIn"
   lines at the top when a number improves.
3. Say what's still unknown and what tracking would answer it.

## Rules

- **No names in the repo** (it's public): the report prints names only with `--names`; never paste them into
  learnings.md or commits. Partner and venue names stay out too (use the event code).
- **Be honest about coverage:** visits (page loads, the funnel, camera diagnostics) start 7 Nov 2026 09:28 PT; album
  tab, photos opened and saves start 9 Nov 2026. Earlier events have sign-ups and photos only. Say so when comparing.
- **Unique phones, not page loads**, for every "how many people" (a phone = the hashed `bs_device` cookie). Instagram's
  in-app browser has its own cookies, so one person can be two phones; call counts "phones" when it matters.
