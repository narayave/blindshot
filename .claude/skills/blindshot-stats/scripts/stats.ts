// The numbers behind one event: funnel, conversion, the long tail after the party, album engagement, camera health.
//   node --env-file=.env.local .claude/skills/blindshot-stats/scripts/stats.ts <code> [--names] [--json]
//   node --env-file=.env.local .claude/skills/blindshot-stats/scripts/stats.ts --compare halloween-fri,halloween,diwali
// --names lists people (local use only; never paste names into the repo). Times are Pacific.
// Data: events, sessions (sign-ups), photos, visits (page loads + camera diagnostics + album engagement).
// Visits started 7 Nov 2026 09:28 PT (the funnel, before that, is sign-ups and photos only); per-photo views and
// saves started 9 Nov 2026 (earlier album visits have no tab, photo or save detail).
import { parseArgs } from "node:util";
import { sql } from "../../../../lib/db.ts";

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { names: { type: "boolean" }, json: { type: "boolean" }, compare: { type: "string" } } });
const GRACE_MS = 15 * 60_000;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const pt = (d: Date | null) => d ? d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const phoneOf = (ua: string | null) => (!ua ? "other" : /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "other");

type Ev = { id: string; code: string; name: string; opens_at: Date | null; closes_at: Date | null; release_at: Date | null; max_shots: number };

async function report(code: string) {
  const [e] = await sql<Ev[]>`select id, code, name, opens_at, closes_at, release_at, max_shots from events where code = ${code}`;
  if (!e) throw new Error(`no event "${code}"`);
  const cutoff = e.closes_at ? new Date(e.closes_at.getTime() + GRACE_MS) : new Date(8.64e15);
  const sessions = await sql<{ id: string; name: string; device_id: string | null; created_at: Date; shot_count: number; rolls: number; user_agent: string | null; instagram: string | null }[]>`
    select id, name, device_id, created_at, shot_count, rolls, user_agent, instagram from sessions where event_id = ${e.id}`;
  const photos = await sql<{ id: string; session_id: string; status: string; captured_at: Date | null; created_at: Date; starred: boolean }[]>`
    select id, session_id, status, captured_at, created_at, starred from photos where event_id = ${e.id}`;
  const visits = await sql<{ visitor: string; kind: string; detail: string | null; at: Date }[]>`
    select visitor, kind, detail, at from visits where event_id = ${e.id} order by at`;

  const night = sessions.filter((s) => s.created_at <= cutoff);
  const after = sessions.filter((s) => s.created_at > cutoff);
  const shooters = night.filter((s) => s.shot_count > 0);
  const done = photos.filter((p) => p.status === "done");
  const bySession = new Map<string, number>(); for (const p of done) bySession.set(p.session_id, (bySession.get(p.session_id) ?? 0) + 1);
  const perShooter = shooters.map((s) => bySession.get(s.id) ?? 0);
  const sessionByDevice = new Map<string, (typeof sessions)[number]>(); for (const s of sessions) if (s.device_id && !sessionByDevice.has(s.device_id)) sessionByDevice.set(s.device_id, s);
  const photoOwner = new Map(photos.map((p) => [p.id, p.session_id]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // hourly shooting
  const hours = new Map<string, number>(); for (const p of done) { const h = (p.captured_at ?? p.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric" }); hours.set(h, (hours.get(h) ?? 0) + 1); }
  const peak = [...hours].sort((a, b) => b[1] - a[1])[0];

  // devices
  const dev = (list: typeof sessions) => { const m: Record<string, number> = {}; for (const s of list) m[phoneOf(s.user_agent)] = (m[phoneOf(s.user_agent)] ?? 0) + 1; return m; };
  const shootRate = (kind: string) => { const signed = night.filter((s) => phoneOf(s.user_agent) === kind); return { signed: signed.length, shot: signed.filter((s) => s.shot_count > 0).length, photos: signed.reduce((a, s) => a + (bySession.get(s.id) ?? 0), 0) }; };

  // funnel (unique phones), during the event window
  const uniq = (pred: (x: (typeof visits)[number]) => boolean) => new Set(visits.filter(pred).map((x) => x.visitor)).size;
  const duringEvent = (x: { at: Date }) => !e.closes_at || x.at <= cutoff;
  const opened = uniq((x) => ["soon", "join", "camera"].includes(x.kind) && duringEvent(x));
  const sawSoon = uniq((x) => x.kind === "soon");
  const sawJoin = uniq((x) => x.kind === "join" && duringEvent(x) && (!e.opens_at || x.at >= e.opens_at));

  // album, after release
  const rel = e.release_at;
  const album = visits.filter((x) => x.kind === "album" && (!rel || x.at >= rel));
  const viewers = new Map<string, { first: Date; loads: number; type: string }>();
  for (const x of album) {
    const s = sessionByDevice.get(x.visitor);
    const type = !s ? "picks only (not signed in)" : s.created_at <= cutoff ? "guest from the night" : "signed in after the party";
    const cur = viewers.get(x.visitor); if (cur) cur.loads++; else viewers.set(x.visitor, { first: x.at, loads: 1, type });
  }
  const byType: Record<string, number> = {}; for (const w of viewers.values()) byType[w.type] = (byType[w.type] ?? 0) + 1;
  const nightGuestsBack = new Set([...viewers.keys()].filter((d) => sessionByDevice.get(d) && sessionByDevice.get(d)!.created_at <= cutoff)).size;
  // long tail: new album viewers per day since release (D0 = release day, Pacific)
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const tail = new Map<string, number>(); for (const w of viewers.values()) tail.set(dayKey(w.first), (tail.get(dayKey(w.first)) ?? 0) + 1);
  // picks -> sign-in: phones that opened the album while not signed in (they saw the public picks), and how many of
  // them signed in afterwards. "Signed in" is judged at the time of each visit.
  const signedAt = (d: string, at: Date) => sessions.some((s) => s.device_id === d && s.created_at <= at);
  const picksPhones = new Set(album.filter((x) => !signedAt(x.visitor, x.at)).map((x) => x.visitor));
  const picksConverted = [...picksPhones].filter((d) => sessions.some((s) => s.device_id === d)).length;

  // engagement (tracked from 9 Nov): photos opened, saves, own vs others'
  const opens = visits.filter((x) => x.kind === "photo" && x.detail);
  const saves = visits.filter((x) => x.kind === "save" && x.detail);
  const isOwn = (x: { visitor: string; detail: string | null }) => { const owner = sessionById.get(photoOwner.get(x.detail!) ?? ""); return !!owner && owner.device_id === x.visitor; };
  const savesOthers = saves.filter((x) => !isOwn(x)).length;
  const topViewed = [...opens.reduce((m, x) => m.set(x.detail!, (m.get(x.detail!) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tabs: Record<string, number> = {}; for (const x of album) if (x.detail) tabs[x.detail] = (tabs[x.detail] ?? 0) + 1;

  // camera health
  // camera health: unique phones per outcome (cam-off split by cause: permission denied vs the viewfinder not on screen)
  const diagSets: Record<string, Set<string>> = {};
  for (const x of visits) if (["cam-live", "cam-off", "cam-stuck", "shot-fail", "blocked"].includes(x.kind)) {
    const k = x.kind === "blocked" ? `blocked: ${x.detail}` : x.kind === "cam-off" ? (/NotAllowed/.test(x.detail ?? "") ? "cam-off: permission denied" : /srcObject/.test(x.detail ?? "") ? "cam-off: started off-screen (bug)" : `cam-off: ${(x.detail ?? "").split(":")[0]}`) : x.kind;
    (diagSets[k] ??= new Set()).add(x.visitor);
  }
  const diag = Object.fromEntries(Object.entries(diagSets).map(([k, set]) => [k, set.size]));

  return {
    event: { code: e.code, name: e.name, opens: pt(e.opens_at), release: pt(e.release_at), closes: pt(e.closes_at), shotsPerRoll: e.max_shots },
    night: {
      photos: done.length, signups: night.length, shooters: shooters.length, rolls: night.reduce((a, s) => a + s.rolls, 0),
      photosPerShooter: { median: median(perShooter), mean: shooters.length ? +(done.length / shooters.length).toFixed(1) : 0, top3share: pct([...perShooter].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0), done.length) },
      peakHour: peak ? `${peak[0]} (${peak[1]} photos)` : "—",
      devices: dev(night), iphone: shootRate("iPhone"), android: shootRate("Android"),
    },
    funnel: { opened, sawComingSoon: sawSoon, sawSignupDuringEvent: sawJoin, signedUp: night.length, tookPhotos: shooters.length,
      rates: { openedToSignup: pct(night.length, opened), signupToShot: pct(shooters.length, night.length), sawSignupToSignup: pct(night.length, sawJoin) } },
    album: { viewers: viewers.size, byType, nightGuestsReturned: `${nightGuestsBack}/${night.length} (${pct(nightGuestsBack, night.length)})`,
      afterPartySignins: after.length, picksPhones: picksPhones.size, picksToSignin: `${picksConverted}/${picksPhones.size} (${pct(picksConverted, picksPhones.size)})`,
      loadsPerViewer: viewers.size ? +(album.length / viewers.size).toFixed(1) : 0, newViewersByDay: Object.fromEntries([...tail].sort()), tabs },
    engagement: { photoOpens: opens.length, uniquePhotosOpened: new Set(opens.map((x) => x.detail)).size, saves: saves.length,
      savesOfOthersPhotos: `${savesOthers}/${saves.length} (${pct(savesOthers, saves.length)})`, topViewed },
    camera: diag,
    names: v.names ? { shooters: shooters.map((s) => `${s.name} ${bySession.get(s.id) ?? 0}`).sort(), afterParty: after.map((s) => s.name) } : undefined,
  };
}

const show = (r: Awaited<ReturnType<typeof report>>) => {
  const { event: e, night: n, funnel: f, album: a, engagement: g } = r;
  console.log(`\n=== ${e.name} (${e.code}) · opens ${e.opens} · album ${e.release} · closes ${e.closes} · ${e.shotsPerRoll} shots/roll`);
  console.log(`NIGHT    ${n.photos} photos · ${n.shooters} shooting / ${n.signups} signed up · ${n.rolls} rolls · peak ${n.peakHour}`);
  console.log(`         photos per shooter: median ${n.photosPerShooter.median}, mean ${n.photosPerShooter.mean}; top 3 shot ${n.photosPerShooter.top3share} of all`);
  console.log(`         devices ${JSON.stringify(n.devices)} · iPhone ${n.iphone.shot}/${n.iphone.signed} shot (${n.iphone.photos} photos) · Android ${n.android.shot}/${n.android.signed} shot (${n.android.photos} photos)`);
  console.log(`FUNNEL   opened link ${f.opened} → saw sign-up (event) ${f.sawSignupDuringEvent} → signed up ${f.signedUp} → shot ${f.tookPhotos}`);
  console.log(`         opened→signed up ${f.rates.openedToSignup} · saw sign-up→signed up ${f.rates.sawSignupToSignup} · signed up→shot ${f.rates.signupToShot} · coming-soon visitors ${f.sawComingSoon}`);
  console.log(`ALBUM    ${a.viewers} viewers ${JSON.stringify(a.byType)} · night guests came back ${a.nightGuestsReturned}`);
  console.log(`         after-party sign-ins ${a.afterPartySignins} · picks-only phones ${a.picksPhones} → signed in ${a.picksToSignin} · ${a.loadsPerViewer} loads/viewer`);
  console.log(`         new viewers by day ${JSON.stringify(a.newViewersByDay)} · tabs ${JSON.stringify(a.tabs)}`);
  console.log(`ENGAGE   photo opens ${g.photoOpens} (${g.uniquePhotosOpened} different) · saves ${g.saves}, of others' photos ${g.savesOfOthersPhotos}`);
  if (g.topViewed.length) console.log(`         most opened: ${g.topViewed.map(([id, n]) => `${id.slice(0, 4)}×${n}`).join(", ")}`);
  console.log(`CAMERA   phones: ${JSON.stringify(r.camera)}`);
  if (r.names) console.log(`NAMES    shooters: ${r.names.shooters.join(", ")}\n         after-party: ${r.names.afterParty.join(", ")}`);
};

const codes = v.compare ? v.compare.split(",") : positionals;
if (!codes.length) { console.error("usage: stats.ts <code> [--names] [--json] | --compare a,b,c"); process.exit(1); }
const out = [];
for (const c of codes) { const r = await report(c.trim()); out.push(r); if (!v.json) show(r); }
if (v.json) console.log(JSON.stringify(out, null, 2));
await sql.end();
