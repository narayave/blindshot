import postgres from "postgres";

const g = globalThis as unknown as { sql?: postgres.Sql };

// One pool per server instance. prepare:false so it works through Supabase's transaction pooler.
export const sql: postgres.Sql =
  g.sql ??
  (g.sql = postgres(process.env.DATABASE_URL ?? "postgres://missing-DATABASE_URL", {
    prepare: false,
    max: 5,
    idle_timeout: 20,
  }));

export type Event = {
  id: string;
  code: string;
  name: string;
  subtitle: string | null;
  theme: string;
  max_shots: number;
  release_at: Date | null;
  allow_opt_outs: boolean;
  date_stamp: boolean;
  overlays: boolean;
  online: boolean; // off: guests get a 404 everywhere; the host still sees it
  opens_at: Date | null; // guests can reach it from here (with online on)
  closes_at: Date | null; // shooting stops here
  focus_check: boolean; // camera trial: wait for focus too, and re-grab if the light missed the frame
};

export async function getEvent(code: string): Promise<Event | null> {
  const [e] = await sql<Event[]>`select * from events where code = ${code}`;
  return e ?? null;
}

export const isReleased = (e: Event) => !!e.release_at && e.release_at.getTime() <= Date.now();
export const isOpen = (e: Event) => e.online && (!e.opens_at || e.opens_at.getTime() <= Date.now());
// Shots taken just before closing are still uploading: the server takes them for a few more minutes.
export const CLOSE_GRACE_MS = 15 * 60_000;
export const isClosed = (e: Event, grace = 0) => !!e.closes_at && e.closes_at.getTime() + grace <= Date.now();
