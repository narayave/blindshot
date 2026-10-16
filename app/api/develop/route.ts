import { NextResponse } from "next/server";
import { getEvent } from "@/lib/db";
import { develop, queued } from "@/lib/process";

// Phones call this while their event has photos waiting, so a burst of uploads keeps developing after the rush.
// Safe to call from anyone: it only works through the queue, one photo at a time per server.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const event = typeof body?.eventCode === "string" ? await getEvent(body.eventCode) : null;
  if (!event) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  await develop(20_000);
  return NextResponse.json({ queued: await queued(event.id) });
}
