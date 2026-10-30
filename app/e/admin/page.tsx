import { isReleased, sql, type Event } from "@/lib/db";
import { isAdmin } from "@/lib/session";
import { setRelease } from "@/app/admin/actions";
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
      <h1 className="headline">Who sees<br /><em>the roll.</em></h1>
      <p className="lede">Off: guests shoot, but nobody sees a frame. On: every guest of that event sees the whole roll. You can switch back any time.</p>
      <ul className="rolls">
        {events.map((e) => {
          const on = isReleased(e);
          return (
            <li key={e.id} className="panel roll-row">
              <div>
                <b>{e.name}</b>
                <span className="fine"> {e.subtitle ? `${e.subtitle} · ` : ""}/e/{e.code}</span>
                <div className="stats"><span><b>{e.guests}</b> guests</span><span><b>{e.photos}</b> photos</span></div>
                <span className="fine">{on ? "Guests can see the roll." : e.release_at ? `Opens by itself ${pt(e.release_at)} PT.` : "Locked until you switch it on."}</span>
                <div className="roll-links">
                  <a className="ghost" href={`/e/${e.code}`}>Guest link</a>
                  <a className="ghost" href={`/admin?event=${e.code}`}>Darkroom</a>
                </div>
              </div>
              <form action={setRelease.bind(null, e.id, on ? "hold" : "now")}>
                <button type="submit" className={`switch${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={`${e.name}: guests see the roll`}>
                  <span>{on ? "On" : "Off"}</span>
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>,
  );
}
