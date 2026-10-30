import { isClosed, isOpen, isReleased, sql, type Event } from "@/lib/db";
import { isAdmin } from "@/lib/session";
import { setOnline, setRelease } from "@/app/admin/actions";
import Login from "@/app/admin/Login";

// /e/admin wins over /e/[code], and no event can be called "admin" (scripts/event.ts refuses it).
export const metadata = { title: "Admin · blindshot", robots: { index: false, follow: false } };

type Row = Event & { guests: number; photos: number };

// Host-only: every event on one page, with the switch that decides whether its guests can see the roll.
export default async function EventsAdmin() {
  const shell = (body: React.ReactNode) => (
    <div className="shell theme-base">
      <div className="admin">
        <header className="top">
          <a className="wordmark" href="/e/admin">blindshot</a>
          <nav className="admin-events"><a href="/e/admin" aria-current="page">Events</a><a href="/admin">Darkroom</a></nav>
        </header>
        {body}
      </div>
    </div>
  );
  if (!(await isAdmin())) return shell(<div className="app"><Login next="/e/admin" /></div>);

  const events = await sql<Row[]>`
    select e.*, (select count(*)::int from sessions s where s.event_id = e.id) as guests,
           (select count(*)::int from photos p where p.event_id = e.id and p.status = 'done') as photos
    from events e order by e.created_at desc`;
  const pt = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });

  return shell(
    <section className="stack">
      <h1 className="headline">Your<br /><em>events.</em></h1>
      <p className="lede">
        <b>Event</b> off: the link is a dead end (404) for everyone but you. On: guests can join and shoot.<br />
        <b>Roll</b> off: guests shoot, but nobody sees a frame. On: every guest of that event sees the whole roll.
      </p>
      <ul className="rolls">
        {events.map((e) => {
          const on = isReleased(e);
          return (
            <li key={e.id} className="panel roll-row">
              <div>
                <b>{e.name}</b>
                <span className="fine"> {e.subtitle ? `${e.subtitle} · ` : ""}/e/{e.code}</span>
                <div className="stats"><span><b>{e.guests}</b> guests</span><span><b>{e.photos}</b> photos</span></div>
                <span className="fine">
                  {!e.online ? "Event is off: guests get a 404. " : !isOpen(e) ? `Opens by itself ${pt(e.opens_at!)} PT. ` : isClosed(e) ? "Shooting has ended. " : "Event is live. "}
                  {e.closes_at && !isClosed(e) ? `Shooting stops ${pt(e.closes_at)} PT. ` : ""}
                  {on ? "Guests can see the roll." : e.release_at ? `Roll opens by itself ${pt(e.release_at)} PT.` : "Roll locked until you switch it on."}
                </span>
                <div className="roll-links">
                  <a className="ghost" href={`/e/${e.code}`}>Guest link</a>
                  <a className="ghost" href={`/admin?event=${e.code}`}>Darkroom</a>
                </div>
              </div>
              <div className="switches">
                <form action={setOnline.bind(null, e.id, !e.online)}>
                  <span className="tiny-label">Event</span>
                  <button type="submit" className={`switch${e.online ? " on" : ""}`} role="switch" aria-checked={e.online} aria-label={`${e.name}: event is live`}>
                    <span>{e.online ? "On" : "Off"}</span>
                  </button>
                </form>
                <form action={setRelease.bind(null, e.id, on ? "hold" : "now")}>
                  <span className="tiny-label">Roll</span>
                  <button type="submit" className={`switch${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={`${e.name}: guests see the roll`}>
                    <span>{on ? "On" : "Off"}</span>
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </section>,
  );
}
