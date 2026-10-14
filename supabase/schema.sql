-- blindshot schema. Safe to re-run.

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,              -- the /e/{code} in the QR link
  name text not null,
  subtitle text,                          -- e.g. "Nov 7 · The Shop · Seattle"
  theme text not null default 'base',     -- see lib/themes.ts
  max_shots int not null default 13,
  release_at timestamptz,                 -- when the shared roll develops; null = held until the host releases it
  allow_opt_outs boolean not null default true, -- show "no promo" / "keep out of shared roll" at join
  date_stamp boolean not null default false,    -- orange LED date on filtered photos
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  token_hash text unique not null,        -- sha256 of the cookie token
  name text not null,
  email text,
  consent_at timestamptz not null,
  no_promo boolean not null default false,     -- don't use my photos for promotion
  private_roll boolean not null default false, -- keep my photos out of the shared roll (host still sees them)
  shot_count int not null default 0,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists photos (
  id uuid primary key,                    -- generated on the phone, so retries are idempotent
  event_id uuid not null references events(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  shot_number int not null,
  original_path text not null,
  filtered_path text,
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'done', 'failed')),
  exif jsonb,                             -- full EXIF incl. GPS; never shown to guests
  device text,
  width int,
  height int,
  captured_at timestamptz,
  uploaded_at timestamptz,
  processed_at timestamptz,
  starred boolean not null default false,
  hidden boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  unique (session_id, shot_number)
);

create index if not exists photos_event_created on photos (event_id, created_at);
