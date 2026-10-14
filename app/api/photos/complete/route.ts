import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { sql } from "@/lib/db";
import { processPhoto } from "@/lib/process";
import { currentSession } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 100_000 ? (v as number) : null);

// The phone finished uploading the original: record metadata and filter it (~1 s).
// Done before responding rather than with after(), so it works on any host; the phone uploads in the background anyway.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const photoId = typeof body?.photoId === "string" && UUID.test(body.photoId) ? body.photoId.toLowerCase() : null;
  if (!photoId) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const [p] = await sql<{ event_id: string; session_id: string; code: string; status: string }[]>`
    select p.event_id, p.session_id, e.code, p.status from photos p join events e on e.id = p.event_id where p.id = ${photoId}`;
  if (!p) return NextResponse.json({ error: "Unknown photo" }, { status: 404 });
  const session = await currentSession(p.event_id, p.code);
  if (session?.id !== p.session_id) return NextResponse.json({ error: "Not your photo" }, { status: 403 });
  if (p.status === "done") return NextResponse.json({ ok: true });

  const captured = typeof body?.capturedAt === "string" && !isNaN(Date.parse(body.capturedAt)) ? new Date(body.capturedAt) : null;
  await sql`
    update photos set status = 'uploaded', uploaded_at = now(), captured_at = ${captured},
      width = ${int(body?.width)}, height = ${int(body?.height)},
      device = ${(await headers()).get("user-agent")?.slice(0, 300) ?? null}
    where id = ${photoId}`;
  await processPhoto(photoId);
  return NextResponse.json({ ok: true });
}
