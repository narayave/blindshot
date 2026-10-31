-- blindshot schema. Safe to re-run.

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,              -- the /e/{code} in the QR link
  name text not null,
  subtitle text,                          -- e.g. "Nov 7 · Seattle"     
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
  email text,                             -- no longer asked at join (kept for older rows)
  instagram text,                         -- optional handle, lowercase without the @, for tagging
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

-- Film-artifact overlays on ~1 in 12 frames (needs the overlays/ folder deployed with the worker).
alter table events add column if not exists overlays boolean not null default false;

alter table sessions add column if not exists instagram text;

-- A guest who finishes a roll can always load another; sessions.rolls counts them.
-- (events.new_rolls from an earlier version is no longer read; harmless if it's still there.)
alter table sessions add column if not exists rolls int not null default 1;

-- Schedule: the event opens to guests at opens_at (with online on), shooting stops at closes_at,
-- and the roll is released at release_at. Null = no time limit on that side.
alter table events add column if not exists opens_at timestamptz;
alter table events add column if not exists closes_at timestamptz;

-- Off = the event doesn't exist for guests (404); the host still sees it. New events start off (scripts/event.ts).
alter table events add column if not exists online boolean not null default true;

-- Camera trial: with the phone light on, also wait for focus to settle and check the light actually reached the frame.
alter table events add column if not exists focus_check boolean not null default false;

-- A named look from LOOKS in lib/film.ts (e.g. 'night'); null = the default film look.
alter table events add column if not exists look text;

-- Worker tries per photo: transient failures are retried, the third failure sticks.
alter table photos add column if not exists attempts int not null default 0;
