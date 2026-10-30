import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentSession, openEvent } from "@/lib/session";

// Load another roll for this guest, on events that allow it, once their current roll is shot.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const event = typeof body?.eventCode === "string" ? await openEvent(body.eventCode) : null;
  if (!event) return NextResponse.json({ error: "This event isn't open." }, { status: 404 });
  if (!event.new_rolls) return NextResponse.json({ error: "One roll per guest at this party." }, { status: 403 });
  const session = await currentSession(event.id, event.code);
  if (!session) return NextResponse.json({ error: "Join the event first." }, { status: 401 });
  // Only when the current roll is finished, so a double tap can't stack up rolls.
  const [s] = await sql<{ rolls: number }[]>`
    update sessions set rolls = rolls + 1
    where id = ${session.id} and shot_count >= ${event.max_shots} * rolls
    returning rolls`;
  if (!s) return NextResponse.json({ error: "Finish this roll first." }, { status: 409 });
  return NextResponse.json({ rolls: s.rolls, shotsLeft: event.max_shots });
}
