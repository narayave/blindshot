import { NextResponse } from "next/server";
import { ORIGINALS } from "@/lib/config";
import { CLOSE_GRACE_MS, isClosed, sql } from "@/lib/db";
import { currentSession, openEvent } from "@/lib/session";
import { uploadUrl } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" };

// Reserve a shot (server-enforced limit) and hand back a write-only upload URL.
// The phone generates photoId, so retrying the same shot never spends a second frame.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const photoId = typeof body?.photoId === "string" && UUID.test(body.photoId) ? body.photoId.toLowerCase() : null;
  const ext = EXT[body?.contentType] ?? "jpg";
  const event = typeof body?.eventCode === "string" ? await openEvent(body.eventCode) : null;
  if (!photoId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!event) return NextResponse.json({ error: "This event isn't open." }, { status: 404 });
  if (isClosed(event, CLOSE_GRACE_MS)) return NextResponse.json({ error: "The night's over: no more shots.", shotsLeft: 0 }, { status: 409 });
  const session = await currentSession(event.id, event.code);
  if (!session) return NextResponse.json({ error: "Join the event first." }, { status: 401 });

  const path = `${event.id}/${session.id}/${photoId}.${ext}`;
  // Atomic: bump the counter only while under the limit, and only for a photo id we haven't seen.
  const [made] = await sql<{ shot_number: number; rolls: number }[]>`
    with s as (
      update sessions set shot_count = shot_count + 1
      where id = ${session.id} and shot_count < ${event.max_shots} * rolls
        and not exists (select 1 from photos where id = ${photoId})
      returning shot_count, rolls
    )
    insert into photos (id, event_id, session_id, shot_number, original_path)
    select ${photoId}, ${event.id}, ${session.id}, shot_count, ${path} from s
    returning shot_number, (select rolls from s)`;

  if (made) {
    return NextResponse.json({ uploadUrl: uploadUrl(ORIGINALS, path), shotsLeft: event.max_shots * made.rolls - made.shot_number });
  }
  // Retry of a shot we already reserved: hand out a fresh URL for the same path.
  const [existing] = await sql<{ original_path: string; status: string }[]>`
    select original_path, status from photos where id = ${photoId} and session_id = ${session.id}`;
  if (existing) {
    const [s] = await sql<{ shot_count: number; rolls: number }[]>`select shot_count, rolls from sessions where id = ${session.id}`;
    return NextResponse.json({ uploadUrl: uploadUrl(ORIGINALS, existing.original_path), shotsLeft: event.max_shots * s.rolls - s.shot_count, status: existing.status });
  }
  return NextResponse.json({ error: "That's the whole roll.", shotsLeft: 0 }, { status: 409 });
}
