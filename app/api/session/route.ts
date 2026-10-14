import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getEvent, sql } from "@/lib/db";
import { newSessionToken } from "@/lib/session";

// Join an event: name + email + consent (+ optional opt-outs). Sets the guest cookie.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const code = typeof body?.eventCode === "string" ? body.eventCode : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  if (!name) return NextResponse.json({ error: "Add your first name." }, { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  if (body?.consent !== true) return NextResponse.json({ error: "Tick the box to agree to how photos are shared." }, { status: 400 });

  const event = await getEvent(code);
  if (!event) return NextResponse.json({ error: "This event doesn't exist." }, { status: 404 });

  const optOuts = event.allow_opt_outs;
  const tokenHash = await newSessionToken(event.code);
  await sql`
    insert into sessions (event_id, token_hash, name, email, consent_at, no_promo, private_roll, user_agent)
    values (${event.id}, ${tokenHash}, ${name}, ${email}, now(),
            ${optOuts && body?.noPromo === true}, ${optOuts && body?.privateRoll === true},
            ${(await headers()).get("user-agent")?.slice(0, 300) ?? null})`;
  return NextResponse.json({ name, shotsUsed: 0 });
}
