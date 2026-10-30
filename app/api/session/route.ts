import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { instagramHandle } from "@/lib/config";
import { sql } from "@/lib/db";
import { newSessionToken, openEvent } from "@/lib/session";

// Join an event: name + consent, optional Instagram handle and opt-outs. Sets the guest cookie.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const code = typeof body?.eventCode === "string" ? body.eventCode : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  const ig = typeof body?.instagram === "string" ? body.instagram.trim() : "";
  const instagram = ig ? instagramHandle(ig) : null;
  if (!name) return NextResponse.json({ error: "Add your first name." }, { status: 400 });
  if (ig && !instagram) return NextResponse.json({ error: "That Instagram handle doesn't look right." }, { status: 400 });
  if (body?.consent !== true) return NextResponse.json({ error: "Tick the box to agree to how photos are shared." }, { status: 400 });

  const event = await openEvent(code);
  if (!event) return NextResponse.json({ error: "This event doesn't exist." }, { status: 404 });

  const optOuts = event.allow_opt_outs;
  const tokenHash = await newSessionToken(event.code);
  await sql`
    insert into sessions (event_id, token_hash, name, instagram, consent_at, no_promo, private_roll, user_agent)
    values (${event.id}, ${tokenHash}, ${name}, ${instagram}, now(),
            ${optOuts && body?.noPromo === true}, ${optOuts && body?.privateRoll === true},
            ${(await headers()).get("user-agent")?.slice(0, 300) ?? null})`;
  return NextResponse.json({ name, shotsUsed: 0 });
}
