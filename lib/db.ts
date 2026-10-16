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
};

export async function getEvent(code: string): Promise<Event | null> {
  const [e] = await sql<Event[]>`select * from events where code = ${code}`;
  return e ?? null;
}

export const isReleased = (e: Event) => !!e.release_at && e.release_at.getTime() <= Date.now();
