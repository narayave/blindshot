import { NextResponse } from "next/server";
import { getEvent, sql } from "@/lib/db";
import { deviceId } from "@/lib/session";

const KINDS = new Set(["soon", "join", "camera", "album", "cam-live", "cam-off", "cam-stuck", "shot", "shot-fail", "blocked"]);

// A page load of an event, for the darkroom's funnel (visited -> signed up -> took photos). Fire-and-forget from the
// browser: never blocks or breaks a page. The visitor is this phone's hashed device id (the same cookie as Mine), so
// visits line up with sign-ups; no names, no IP addresses, nothing in the phone's storage.
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const kind = KINDS.has(b?.kind) ? (b.kind as string) : null;
  const event = typeof b?.code === "string" && kind ? await getEvent(b.code).catch(() => null) : null;
  if (!event?.online) return new NextResponse(null, { status: 204 });
  const visitor = await deviceId();
  const detail = typeof b?.detail === "string" ? b.detail.slice(0, 200) : null; // camera diagnostics: what happened
  await sql`insert into visits (event_id, visitor, kind, detail) values (${event.id}, ${visitor}, ${kind}, ${detail})`.catch(() => {});
  return new NextResponse(null, { status: 204 });
}
