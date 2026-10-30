import { notFound } from "next/navigation";
import { FILTERED, thumbPath } from "@/lib/config";
import { isReleased, sql } from "@/lib/db";
import { currentSession, isAdmin, openEvent, sameGuest } from "@/lib/session";
import { readUrls } from "@/lib/storage";
import { themeClass } from "@/lib/themes";
import HostOnly from "../HostOnly";
import Sheet from "./Sheet";

const PAGE = 40;
type Tab = "all" | "picks" | "mine";

export default async function RollPage({ params, searchParams }: PageProps<"/e/[code]/roll">) {
  const event = await openEvent((await params).code);
  if (!event) notFound();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "picks" || sp.tab === "mine" ? sp.tab : "all";
  const limit = Math.min(2000, Math.max(PAGE, Number(sp.n) || PAGE));
  const [session, admin] = await Promise.all([currentSession(event.id, event.code), isAdmin()]);

  const shell = (body: React.ReactNode) => (
    <div className={`shell ${themeClass(event.theme)}`}>
      {!event.online && <HostOnly />}
      <div className="app">
        <header className="top">
          <a className="wordmark" href={`/e/${event.code}`}>blindshot</a>
          {admin ? <a className="back" href={`/admin?event=${event.code}`}>← Darkroom</a> : <a className="back" href={`/e/${event.code}`}>← Camera</a>}
          <div className="event"><b>{event.name}</b>{event.subtitle && <><br />{event.subtitle}</>}</div>
        </header>
        {body}
      </div>
    </div>
  );

  if (!session && !admin) {
    return shell(
      <section className="stack">
        <h1 className="headline">The roll is<br /><em>for guests.</em></h1>
        <p className="lede">Open this on the phone you shot with at the party.</p>
      </section>,
    );
  }
  if (!isReleased(event) && !admin) {
    return shell(
      <section className="stack">
        <h1 className="headline">Still<br /><em>developing.</em></h1>
        <p className="lede">Nobody sees a frame until the whole roll is ready.</p>
        <a className="ghost" href={`/e/${event.code}`}>Back to the camera</a>
      </section>,
    );
  }

  const me = session?.id ?? null;
  // Yours: this visit, plus earlier visits (any phone) where you joined with the same first name and Instagram.
  const who = session && sameGuest(session);
  const mine = who ? sql`(s.id = ${me} or (s.instagram = ${who.instagram} and lower(trim(s.name)) = ${who.name}))` : sql`s.id = ${me}`;
  // Visible to guests: processed, not hidden by the host, and not from someone who kept their roll private (unless it's yours).
  const visible = sql`p.event_id = ${event.id} and p.status = 'done' and not p.hidden and (not s.private_roll or ${mine})`;
  const [counts] = await sql<{ n_all: number; n_picks: number; n_mine: number }[]>`
    select count(*)::int as n_all,
           count(*) filter (where p.starred)::int as n_picks,
           count(*) filter (where ${mine})::int as n_mine
    from photos p join sessions s on s.id = p.session_id where ${visible}`;
  const rows = await sql<{ id: string; filtered_path: string; name: string; shot_number: number; starred: boolean; mine: boolean }[]>`
    select p.id, p.filtered_path, s.name, p.shot_number, p.starred, ${mine} as mine
    from photos p join sessions s on s.id = p.session_id
    where ${visible}
      ${tab === "picks" ? sql`and p.starred` : tab === "mine" ? sql`and ${mine}` : sql``}
    order by p.captured_at desc nulls last, p.created_at desc
    limit ${limit}`;
  const url = readUrls(FILTERED);
  const total = tab === "all" ? counts.n_all : tab === "picks" ? counts.n_picks : counts.n_mine;
  const tabLink = (t: Tab, label: string, n: number) => (
    <a href={`?tab=${t}`} aria-current={tab === t ? "page" : undefined}>{label}<small>{n.toLocaleString()}</small></a>
  );

  return shell(
    <section className="stack">
      <h1 className="headline">The party&apos;s<br /><em>roll.</em></h1>
      <div className="tabs">
        {tabLink("all", "Everyone", counts.n_all)}
        {tabLink("picks", "Host picks", counts.n_picks)}
        {tabLink("mine", "Mine", counts.n_mine)}
      </div>
      <Sheet
        frames={rows.map((r) => ({ id: r.id, thumb: url(thumbPath(r.filtered_path)), src: url(r.filtered_path), by: r.mine ? "You" : r.name, n: r.shot_number, star: r.starred }))}
        moreHref={rows.length < total ? `?tab=${tab}&n=${limit + PAGE}` : null}
        empty={tab === "mine" ? "None of your shots are in yet." : "Nothing here yet."}
        name={event.code}
      />
    </section>,
  );
}
