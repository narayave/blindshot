import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isReleased } from "@/lib/db";
import { eventLink } from "@/lib/qr";
import { currentSession, openEvent } from "@/lib/session";
import { theme, themeClass } from "@/lib/themes";
import CameraApp from "./CameraApp";
import HostOnly from "./HostOnly";

export async function generateMetadata({ params }: PageProps<"/e/[code]">): Promise<Metadata> {
  const event = await openEvent((await params).code);
  return { title: event ? `${event.name} · blindshot` : "blindshot" };
}

export default async function EventPage({ params }: PageProps<"/e/[code]">) {
  const event = await openEvent((await params).code);
  if (!event) notFound();
  const session = await currentSession(event.id, event.code);
  const { qr } = await eventLink(event.code);
  return (
    <div className={`shell ${themeClass(event.theme)}`}>
      {!event.online && <HostOnly />}
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
          newRolls: event.new_rolls,
        }}
        qr={qr}
        guest={session ? { name: session.name, shotsUsed: session.shot_count - event.max_shots * (session.rolls - 1) } : null}
      />
    </div>
  );
}
