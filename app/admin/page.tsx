import { headers } from "next/headers";
import QRCode from "qrcode";
import { FILTERED, ORIGINALS, thumbPath } from "@/lib/config";
import { isReleased, sql, type Event } from "@/lib/db";
import { isAdmin } from "@/lib/session";
import { readUrls } from "@/lib/storage";
import { reprocess, setRelease, toggle } from "./actions";
import Login from "./Login";

export const metadata = { title: "Darkroom · blindshot" };

type Row = {
  id: string; filtered_path: string | null; original_path: string; status: string; error: string | null;
  starred: boolean; hidden: boolean; shot_number: number; name: string; instagram: string | null; no_promo: boolean; private_roll: boolean;
};
const VIEWS = ["all", "starred", "hidden", "problems"] as const;

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
           s.name, s.instagram, s.no_promo, s.private_roll
    from photos p join sessions s on s.id = p.session_id
    where p.event_id = ${event.id}
      ${view === "starred" ? sql`and p.starred` : view === "hidden" ? sql`and p.hidden` : view === "problems" ? sql`and p.status <> 'done'` : sql``}
    order by p.created_at desc limit 500`;

  const h = await headers();
  const origin = process.env.SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const link = `${origin}/e/${event.code}`;
  const qr = await QRCode.toString(link, { type: "svg", margin: 1 });
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
              {v === "all" ? "All" : v === "starred" ? "Starred" : v === "hidden" ? "Hidden" : "Problems"}
            </a>
          ))}
        </nav>

        <div className="admin-grid">
          {rows.length === 0 && <p className="lede">No photos here yet.</p>}
          {rows.map((r) => (
            <article key={r.id} className={`card${r.hidden ? " is-hidden" : ""}`}>
              {r.filtered_path
                ? // eslint-disable-next-line @next/next/no-img-element
                  <a href={original(r.original_path)} target="_blank" rel="noreferrer" title="Open the untouched original"><img src={filtered(thumbPath(r.filtered_path))} alt={`${r.name}, shot ${r.shot_number}`} loading="lazy" /></a>
                : <div className="card-status">{r.status === "failed" ? "Filter failed" : "Developing…"}</div>}
              <div className="card-meta">
                <span>
                  {r.name} · {r.shot_number}
                  {r.instagram && <> · <a href={`https://instagram.com/${r.instagram}`} target="_blank" rel="noreferrer">@{r.instagram}</a></>}
                </span>
                <span className="badges">
                  {r.no_promo && <i title="Don't use for promotion">no promo</i>}
                  {r.private_roll && <i title="Kept out of the shared roll">private</i>}
                </span>
              </div>
              <div className="card-actions">
                <form action={toggle.bind(null, r.id, "starred")}><button type="submit" aria-pressed={r.starred}>{r.starred ? "★ Starred" : "☆ Star"}</button></form>
                <form action={toggle.bind(null, r.id, "hidden")}><button type="submit" aria-pressed={r.hidden}>{r.hidden ? "Unhide" : "Hide"}</button></form>
                {r.status !== "done" && <form action={reprocess.bind(null, r.id)}><button type="submit" title={r.error ?? undefined}>Retry</button></form>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
