import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getEvent, sql, type Event } from "./db";

// Guests have no accounts: joining an event sets an httpOnly cookie holding a random token.
// Only its hash is stored. One cookie per event so a phone can join several events.
export type Session = {
  id: string;
  event_id: string;
  name: string;
  shot_count: number; // across all of this guest's rolls
  rolls: number; // rolls loaded so far: this guest may shoot max_shots × rolls
  private_roll: boolean;
  no_promo: boolean;
};

const cookieName = (eventCode: string) => `bs_${eventCode}`;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function currentSession(eventId: string, eventCode: string): Promise<Session | null> {
  const token = (await cookies()).get(cookieName(eventCode))?.value;
  if (!token) return null;
  const [s] = await sql<Session[]>`
    select id, event_id, name, shot_count, rolls, private_roll, no_promo
    from sessions where token_hash = ${hash(token)} and event_id = ${eventId}`;
  return s ?? null;
}

export async function newSessionToken(eventCode: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  (await cookies()).set(cookieName(eventCode), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return hash(token);
}

// An event as guests may reach it: an offline event doesn't exist for anyone but the host.
export async function openEvent(code: string): Promise<Event | null> {
  const e = await getEvent(code);
  return e && (e.online || (await isAdmin())) ? e : null;
}

// Host admin: one shared password from ADMIN_PASSWORD; the cookie holds an HMAC of it, never the password.
const ADMIN_COOKIE = "bs_admin";
const adminProof = () => createHmac("sha256", process.env.ADMIN_PASSWORD ?? "").update("blindshot-admin").digest("hex");

export async function isAdmin(): Promise<boolean> {
  const v = (await cookies()).get(ADMIN_COOKIE)?.value ?? ""; // read first: this is what makes pages using it dynamic
  if (!process.env.ADMIN_PASSWORD) return false;
  const want = adminProof();
  return v.length === want.length && timingSafeEqual(Buffer.from(v), Buffer.from(want));
}

export async function adminLogin(password: string): Promise<boolean> {
  const real = process.env.ADMIN_PASSWORD ?? "";
  const ok = !!real && password.length === real.length && timingSafeEqual(Buffer.from(password), Buffer.from(real));
  if (ok) {
    (await cookies()).set(ADMIN_COOKIE, adminProof(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return ok;
}
