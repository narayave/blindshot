import { FILTERED, ORIGINALS, thumbPath } from "@/lib/config";
import { isReleased, sql, type Event } from "@/lib/db";
import { eventLink } from "@/lib/qr";
import { isAdmin } from "@/lib/session";
import { readUrls } from "@/lib/storage";
import { reprocess, setRelease, toggle } from "./actions";
import Login from "./Login";
import Wiggles, { type WFrame } from "./Wiggles";
import { wiggleCandidates } from "@/lib/wiggle";

export const metadata = { title: "Darkroom · blindshot" };

type Row = {
  id: string; filtered_path: string | null; original_path: string; status: string; error: string | null;
  starred: boolean; hidden: boolean; shot_number: number; name: string; instagram: string | null; device: string | null; twin: boolean; no_promo: boolean; private_roll: boolean;
};
const VIEWS = ["all", "starred", "hidden", "problems", "wiggles"] as const;

export default async function Admin({ searchParams }: PageProps<"/admin">) {
  if (!(await isAdmin())) {
    return (
      <div className="shell theme-base">
        <div className="app">
          <header className="top"><span className="wordmark">blindshot</span><span className="event">Darkroom</span></header>
          <Login />
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const events = await sql<Event[]>`select * from events order by created_at desc`;
  const event = events.find((e) => e.code === sp.event) ?? events[0];
  if (!event) {
    return <div className="shell theme-base"><div className="app"><p className="lede">No events yet. Create one with <code>npm run event</code>.</p></div></div>;
  }
  const view = VIEWS.includes(sp.view as never) ? (sp.view as (typeof VIEWS)[number]) : "all";

  const [stats] = await sql<{ guests: number; shots: number; done: number; problems: number; starred: number }[]>`
    select (select count(*)::int from sessions where event_id = ${event.id}) as guests,
           count(*)::int as shots,
           count(*) filter (where status = 'done')::int as done,
           count(*) filter (where status = 'failed' or (status <> 'done' and created_at < now() - interval '10 minutes'))::int as problems,
           count(*) filter (where starred)::int as starred
    from photos where event_id = ${event.id}`;
  const rows = await sql<Row[]>`
    select p.id, p.filtered_path, p.original_path, p.status, p.error, p.starred, p.hidden, p.shot_number,
           s.name, s.instagram, s.no_promo, s.private_roll, s.user_agent as device,
           exists (select 1 from sessions o where o.event_id = s.event_id and o.id <> s.id and o.instagram is not null
                   and o.instagram = s.instagram and lower(trim(o.name)) = lower(trim(s.name))
                   and o.device_id is distinct from s.device_id and o.device_id is not null and s.device_id is not null) as twin
    from photos p join sessions s on s.id = p.session_id
    where p.event_id = ${event.id}
      ${view === "starred" ? sql`and p.starred` : view === "hidden" ? sql`and p.hidden` : view === "problems" ? sql`and p.status <> 'done'` : sql``}
    order by p.created_at desc limit 500`;

  const { link, qr } = await eventLink(event.code);
  const filtered = readUrls(FILTERED), original = readUrls(ORIGINALS);
  const released = isReleased(event);

  return (
    <div className="shell theme-base">
      <div className="admin">
        <header className="top">
          <a className="wordmark" href="/e/admin" title="All events">blindshot</a>
          <nav className="admin-events">
            <a className="back" href="/e/admin">← All events</a>
            {events.map((e) => <a key={e.id} href={`?event=${e.code}`} aria-current={e.id === event.id ? "page" : undefined}>{e.name}</a>)}
          </nav>
        </header>

        <section className="admin-head">
          <div className="stack">
            <h1 className="headline">{event.name}</h1>
            <div className="stats">
              <span><b>{stats.guests}</b> cameras</span>
              <span><b>{stats.shots}</b> shots</span>
              <span><b>{stats.done}</b> developed</span>
              <span><b>{stats.starred}</b> starred</span>
              {stats.problems > 0 && <span className="warn"><b>{stats.problems}</b> need a look</span>}
            </div>
            <div className="panel">
              <div className="row">
                <span>Shared roll</span>
                <span>{released ? "Released" : event.release_at ? `Develops ${event.release_at.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })} PT` : "Held until you release it"}</span>
              </div>
              <form action={setRelease.bind(null, event.id, released ? "hold" : "now")}>
                <button className="ghost" type="submit">{released ? "Hide the roll again" : "Release the roll now"}</button>
              </form>
              <a className="fine" href={`/e/${event.code}/roll`}>Preview the roll as a guest →</a>
            </div>
          </div>
          <figure className="qr">
            <div dangerouslySetInnerHTML={{ __html: qr }} />
            <figcaption><a href={link}>{link}</a></figcaption>
          </figure>
        </section>

        <nav className="tabs admin-tabs">
          {VIEWS.map((v) => (
            <a key={v} href={`?event=${event.code}&view=${v}`} aria-current={view === v ? "page" : undefined}>
              {v === "all" ? "All" : v === "starred" ? "Starred" : v === "hidden" ? "Hidden" : v === "problems" ? "Problems" : "Wiggles"}
            </a>
          ))}
        </nav>

        {view === "wiggles" ? await wigglesView(event.id, filtered) : <div className="admin-grid">
          {rows.length === 0 && <p className="lede">No photos here yet.</p>}
          {rows.map((r) => (
            <article key={r.id} className={`card${r.hidden ? " is-hidden" : ""}`}>
              {r.filtered_path
                ? // eslint-disable-next-line @next/next/no-img-element
                  <a href={filtered(r.filtered_path)} target="_blank" rel="noreferrer" title="Open the developed photo full size"><img src={filtered(thumbPath(r.filtered_path))} alt={`${r.name}, shot ${r.shot_number}`} loading="lazy" /></a>
                : <div className="card-status">{r.status === "failed" ? "Filter failed" : "Developing…"}</div>}
              <div className="card-meta">
                <span>
                  {r.name} · {r.shot_number}
                  {r.instagram && <> · <a href={`https://instagram.com/${r.instagram}`} target="_blank" rel="noreferrer">@{r.instagram}</a></>}
                  <br /><small className="device">{phoneOf(r.device)}{r.twin && <b title="The same name and Instagram joined from a different phone"> · ⚠ also on another phone</b>}</small>
                </span>
                <span className="badges">
                  {r.no_promo && <i title="Don't use for promotion">no promo</i>}
                  {r.private_roll && <i title="Kept out of the shared roll">private</i>}
                </span>
              </div>
              <div className="card-actions">
                <form action={toggle.bind(null, r.id, "starred")}><button type="submit" aria-pressed={r.starred}>{r.starred ? "★ Starred" : "☆ Star"}</button></form>
                <form action={toggle.bind(null, r.id, "hidden")}><button type="submit" aria-pressed={r.hidden}>{r.hidden ? "Unhide" : "Hide"}</button></form>
                <a href={original(r.original_path)} target="_blank" rel="noreferrer" title="The untouched file from the phone">Original</a>
                {r.status !== "done" && <form action={reprocess.bind(null, r.id)}><button type="submit" title={r.error ?? undefined}>Retry</button></form>}
              </div>
            </article>
          ))}
        </div>}
      </div>
    </div>
  );
}

// Developed shots from the same moment on different phones, and the wiggles already grouped.
async function wigglesView(eventId: string, filtered: (path: string) => string) {
  const shots = await sql<{ id: string; filtered_path: string; captured_at: Date | null; phone: string; name: string; wiggle: string | null; wiggle_x: number | null; wiggle_y: number | null }[]>`
    select p.id, p.filtered_path, p.captured_at, coalesce(s.device_id, s.id::text) as phone, s.name, p.wiggle::text, p.wiggle_x, p.wiggle_y
    from photos p join sessions s on s.id = p.session_id
    where p.event_id = ${eventId} and p.status = 'done' and not p.hidden
    order by p.captured_at`;
  const frame = (r: (typeof shots)[number]): WFrame => ({
    id: r.id, thumb: filtered(thumbPath(r.filtered_path)), name: r.name, x: r.wiggle_x, y: r.wiggle_y,
    at: r.captured_at?.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", timeStyle: "medium" }) ?? "",
  });
  const saved = [...Map.groupBy(shots.filter((r) => r.wiggle), (r) => r.wiggle!)].map(([id, fs]) => ({ id, frames: fs.map(frame) }));
  const candidates = wiggleCandidates(shots.filter((r) => !r.wiggle).map((r) => ({ ...r, at: r.captured_at }))).reverse().map((g) => g.map(frame));
  return <Wiggles saved={saved} candidates={candidates} />;
}

// "iPhone · Safari", "Samsung SM-S918B · Chrome": enough to tell phones apart at a glance.
function phoneOf(ua: string | null): string {
  if (!ua) return "unknown phone";
  const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome/.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "browser";
  const phone = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim() || (/Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : "computer");
  return `${phone} · ${browser}`;
}
