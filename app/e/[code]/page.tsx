import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEvent, isClosed, isReleased } from "@/lib/db";
import { eventLink } from "@/lib/qr";
import { currentSession, openEvent } from "@/lib/session";
import { theme, themeClass } from "@/lib/themes";
import CameraApp from "./CameraApp";
import Countdown from "./Countdown";
import HostOnly from "./HostOnly";

// Open (or the host), else switched on but not open yet: guests get the "coming soon" page with a countdown, so the
// link works the minute it's shared. Switched off, or closed and gone: a 404.
async function load(code: string) {
  const open = await openEvent(code);
  if (open) return { event: open, soon: false };
  const e = await getEvent(code);
  return e?.online && e.opens_at && e.opens_at.getTime() > Date.now() ? { event: e, soon: true } : null;
}

export async function generateMetadata({ params }: PageProps<"/e/[code]">): Promise<Metadata> {
  const found = await load((await params).code);
  return { title: found ? `${found.event.name} · blindshot` : "blindshot" };
}

export default async function EventPage({ params }: PageProps<"/e/[code]">) {
  const found = await load((await params).code);
  if (!found) notFound();
  const { event, soon } = found;
  const session = await currentSession(event.id, event.code);
  const { qr } = await eventLink(event.code);
  return (
    <div className={`shell ${themeClass(event.theme)}`}>
      {!event.online && <HostOnly eventId={event.id} look={event.look} />}
      {!soon && <Countdown release={event.release_at?.toISOString() ?? null} closes={event.closes_at?.toISOString() ?? null} code={event.code} />}
      <CameraApp
        event={{
          code: event.code,
          name: event.name,
          subtitle: event.subtitle,
          maxShots: event.max_shots,
          allowOptOuts: event.allow_opt_outs,
          releaseAt: event.release_at?.toISOString() ?? null,
          released: isReleased(event),
          chip: theme(event.theme).chip,
          decor: theme(event.theme).decor,
          closed: isClosed(event),
          focusCheck: event.focus_check,
          polaroid: event.look === "polaroid",
          photobooth: event.look === "photobooth",
          closesAt: event.closes_at?.toISOString() ?? null,
          opensAt: event.opens_at?.toISOString() ?? null,
          soon,
        }}
        qr={qr}
        guest={session && !soon ? { name: session.name, shotsUsed: session.shot_count - event.max_shots * (session.rolls - 1), roll: session.rolls } : null}
      />
    </div>
  );
}
