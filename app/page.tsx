import { connection } from "next/server";
import { MAKER_HANDLE } from "@/lib/config";
import { sql, type Event } from "@/lib/db";

// Real nights only (not the owner's bench, trials or test events): enough photos to count, or still to come.
async function nights() {
  return sql<(Pick<Event, "code" | "name" | "subtitle" | "online" | "opens_at" | "closes_at"> & { photos: number })[]>`
    select e.code, e.name, e.subtitle, e.online, e.opens_at, e.closes_at,
           (select count(*)::int from photos p where p.event_id = e.id and p.status = 'done') as photos
    from events e
    where e.opens_at is not null and e.code not like 'e2e-%'
      and ((select count(*) from photos p where p.event_id = e.id and p.status = 'done') >= 20
           or (e.online and (e.closes_at is null or e.closes_at > now())))
    order by e.opens_at desc`.catch(() => []);
}

export default async function Home() {
  await connection(); // read the events on every visit, not once at build time
  const list = await nights();
  const ig = <a href={`https://instagram.com/${MAKER_HANDLE}`} target="_blank" rel="noreferrer">@{MAKER_HANDLE}</a>;
  return (
    <div className="shell theme-base">
      <main className="app">
        <header className="top"><span className="wordmark">blindshot</span></header>
        <section className="stack">
          <h1 className="headline">A disposable camera<br /><em>for your party.</em></h1>
          <p className="lede">Guests scan a QR code and shoot a roll in a tiny viewfinder: no app, no previews, a real film look. Then the whole party&apos;s album opens at once, and everyone gets every photo.</p>
          {list.length > 0 && (
            <div className="nights">
              <h2 className="nights-h">Where it&apos;s been</h2>
              <ul>
                {list.map((e) => {
                  const live = e.online && (!e.closes_at || e.closes_at.getTime() > Date.now());
                  return (
                    <li key={e.code}>
                      <b>{live ? <a href={`/e/${e.code}`}>{e.name}</a> : e.name}</b>
                      <span>{e.subtitle}{live ? (!e.opens_at || e.opens_at.getTime() <= Date.now() ? " · happening now" : " · coming up") : ` · ${e.photos} photos`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <p className="pitch">Want a disposable-camera night at your event? Message {ig} on Instagram.</p>
          <div className="stripes" aria-hidden><i /><i /><i /></div>
          <p className="fine">Got a QR code from a host? Scan it to load your film.</p>
        </section>
      </main>
    </div>
  );
}
