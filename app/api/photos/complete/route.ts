import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { sql } from "@/lib/db";
import { currentSession } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 100_000 ? (v as number) : null);

// The phone finished uploading the original: record it and queue it for the film filter.
// The worker (scripts/worker.ts) develops it; this request never touches the image, so uploads stay fast in a rush.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const photoId = typeof body?.photoId === "string" && UUID.test(body.photoId) ? body.photoId.toLowerCase() : null;
  if (!photoId) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const [p] = await sql<{ event_id: string; session_id: string; code: string; status: string }[]>`
    select p.event_id, p.session_id, e.code, p.status from photos p join events e on e.id = p.event_id where p.id = ${photoId}`;
  if (!p) return NextResponse.json({ error: "Unknown photo" }, { status: 404 });
  const session = await currentSession(p.event_id, p.code);
  if (session?.id !== p.session_id) return NextResponse.json({ error: "Not your photo" }, { status: 403 });
  if (p.status === "done" || p.status === "uploaded") return NextResponse.json({ ok: true }); // a retry: already queued

  // Shift the phone's capture time by how far its clock is off ours, so shots from different phones
  // line up (wigglegrams are found by matching capture times across guests).
  const time = (v: unknown) => (typeof v === "string" && !isNaN(Date.parse(v)) ? Date.parse(v) : null);
  const at = time(body?.capturedAt), sent = time(body?.sentAt);
  const captured = at === null ? null : new Date(sent === null ? at : at + (Date.now() - sent));
  await sql`
    update photos set status = 'uploaded', uploaded_at = now(), captured_at = ${captured},
      width = ${int(body?.width)}, height = ${int(body?.height)},
      device = ${(await headers()).get("user-agent")?.slice(0, 300) ?? null}
    where id = ${photoId}`;
  return NextResponse.json({ ok: true });
}
