-- Loam core schema — the composable spine.
-- Nine structures: sources, entries, measurements, entities, edges,
-- tags/entry_tags, events, facts, correlations + surfacing_rules/surfaced_log.
--
-- Design rules encoded here:
--   * Generic core. Domain detail lives in `metadata jsonb`, never new tables.
--   * `type`, `metric`, `rel`, `category` are OPEN vocabulary: intentionally
--     NOT constrained by enums so new values never require a migration.
--     Only small closed sets (processing status, origin, node kind) are checked.
--   * Idempotent ingest: every writable stream has a dedup key.
--   * Time, once: every timestamp is timestamptz (UTC) paired with an IANA `tz`.
--   * Fail loud: entries carry a visible `status` and `error`.
--   * Single-user. RLS is enabled and fail-closed; the authenticated owner sees
--     everything, service_role (ingestion) bypasses RLS as usual.

set check_function_bodies = off;

-- gen_random_uuid() is built into Postgres 13+; pgcrypto kept for safety.
create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- shared: updated_at trigger
-- --------------------------------------------------------------------------
create or replace function loam_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- sources — registry of ingestion channels. A new channel is a row, not a migration.
-- --------------------------------------------------------------------------
create table sources (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,                       -- e.g. telegram, share_sheet, voice, health_connect, bank_csv, manual
  kind        text not null default 'capture'
                check (kind in ('capture','ingest','derived')),
  label       text,
  config      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_sources_touch before update on sources
  for each row execute function loam_touch_updated_at();

-- --------------------------------------------------------------------------
-- entries — the universal capture (qualitative layer). Content is markdown.
-- --------------------------------------------------------------------------
create table entries (
  id                 uuid primary key default gen_random_uuid(),
  source_id          uuid not null references sources(id),
  type               text not null,                       -- OPEN: note, link, media, voice, task, idea, transaction, email, message, checkin, reflection, workout...
  title              text,
  content_md         text,                                -- canonical enriched markdown
  content_raw        text,                                -- original input / transcript, preserved
  url                text,
  occurred_at        timestamptz,                         -- when the thing happened (UTC)
  captured_at        timestamptz not null default now(),  -- when it entered Loam
  tz                 text not null default 'Europe/Amsterdam',
  estimated_duration interval,
  deadline           timestamptz,
  recurrence         text,                                -- RRULE
  status             text not null default 'captured'
                       check (status in ('captured','processing','enriched','linked','failed','archived')),
  confidence         numeric,                             -- enrichment confidence 0-1
  source_uid         text,                                -- external record id (Health Connect metadata.id, gmail id...)
  dedup_key          text,                                -- idempotency key within a source
  domain             text,                                -- soft grouping: work / personal / health / finance...
  metadata           jsonb not null default '{}'::jsonb,
  error              text,                                -- set when status = failed (visible not-saved signal)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint entries_dedup_unique unique (source_id, dedup_key)
);
create trigger trg_entries_touch before update on entries
  for each row execute function loam_touch_updated_at();

create index entries_type_idx        on entries (type);
create index entries_status_idx      on entries (status);
create index entries_domain_idx      on entries (domain);
create index entries_occurred_at_idx on entries (occurred_at desc);
create index entries_deadline_idx    on entries (deadline) where deadline is not null;
create index entries_metadata_gin    on entries using gin (metadata);
-- Dutch full-text over title + content. No vector store in v1.
create index entries_fts_idx on entries using gin (
  to_tsvector('dutch', coalesce(title,'') || ' ' || coalesce(content_md,''))
);

-- --------------------------------------------------------------------------
-- measurements — the uniform numeric stream (quantitative layer). Correlations run here.
-- --------------------------------------------------------------------------
create table measurements (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid references entries(id) on delete set null,
  metric      text not null,                              -- OPEN: sleep_min, steps, weight_kg, body_fat_pct, screen_min, spend_eur, energy, mood...
  value       numeric not null,
  unit        text,
  observed_at timestamptz not null,                       -- when measured (UTC)
  tz          text not null default 'Europe/Amsterdam',
  source_id   uuid not null references sources(id),
  source_uid  text,                                       -- Health Connect / external UID (stable across edits)
  metadata    jsonb not null default '{}'::jsonb,         -- device, data-origin package, last_modified, quality flags
  created_at  timestamptz not null default now()
);
-- Dedup by external UID, never by date: same-day multiples are distinct rows.
create unique index measurements_source_uid_unique
  on measurements (source_id, source_uid) where source_uid is not null;
create index measurements_metric_time_idx on measurements (metric, observed_at desc);
create index measurements_entry_idx       on measurements (entry_id);

-- --------------------------------------------------------------------------
-- entities — the durable nouns. Projects & clients live here, first-class.
-- --------------------------------------------------------------------------
create table entities (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,                             -- OPEN: person, client, project, organization, place, account, subscription, habit, goal, vendor...
  name         text not null,
  status       text,
  metadata     jsonb not null default '{}'::jsonb,        -- deadline, value, follow_up_cycle, contract_end, aliases, scope...
  external_ref text,                                      -- migration provenance (old Notion / Supabase id)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_entities_touch before update on entities
  for each row execute function loam_touch_updated_at();

create index entities_type_idx     on entities (type);
create index entities_status_idx   on entities (status);
create index entities_metadata_gin on entities using gin (metadata);

-- --------------------------------------------------------------------------
-- edges — generic graph. Any node to any node. Polymorphic by (kind, id).
-- --------------------------------------------------------------------------
create table edges (
  id        uuid primary key default gen_random_uuid(),
  src_kind  text not null check (src_kind in ('entry','entity','measurement','event','fact')),
  src_id    uuid not null,
  dst_kind  text not null check (dst_kind in ('entry','entity','measurement','event','fact')),
  dst_id    uuid not null,
  rel       text not null,                                -- OPEN: about, mentions, belongs_to, blocks, waiting_on, part_of, caused_by, correlates_with, duplicate_of...
  weight    numeric,
  origin    text not null default 'ai' check (origin in ('ai','manual','rule')),
  metadata  jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint edges_unique unique (src_kind, src_id, dst_kind, dst_id, rel)
);
create index edges_src_idx on edges (src_kind, src_id);
create index edges_dst_idx on edges (dst_kind, dst_id);
create index edges_rel_idx on edges (rel);

-- --------------------------------------------------------------------------
-- tags / entry_tags — labels with provenance. Manual always wins.
-- --------------------------------------------------------------------------
create table tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  kind       text,                                        -- topic, domain, project, sentiment, auto...
  origin     text not null default 'ai' check (origin in ('ai','manual','rule')),
  created_at timestamptz not null default now()
);

create table entry_tags (
  entry_id   uuid not null references entries(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  origin     text not null default 'ai' check (origin in ('ai','manual','rule')),
  confidence numeric,
  created_at timestamptz not null default now(),
  primary key (entry_id, tag_id)
);
create index entry_tags_tag_idx on entry_tags (tag_id);

-- --------------------------------------------------------------------------
-- events — first-class timestamped completions & activity. The dopamine primitive.
-- --------------------------------------------------------------------------
create table events (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,                             -- OPEN: completed, checked_in, captured, enriched, nudge_sent, streak_hit, dismissed, followed_up...
  subject_kind text check (subject_kind in ('entry','entity','measurement','fact','correlation','rule')),
  subject_id   uuid,
  occurred_at  timestamptz not null default now(),
  value        numeric,                                   -- optional delta (progress %, minutes, count)
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index events_type_idx    on events (type);
create index events_subject_idx on events (subject_kind, subject_id);
create index events_time_idx    on events (occurred_at desc);

-- --------------------------------------------------------------------------
-- facts — self-evolving knowledge about the user. Asserted or inferred.
-- --------------------------------------------------------------------------
create table facts (
  id             uuid primary key default gen_random_uuid(),
  statement      text not null,
  category       text,                                    -- OPEN & dynamic: created/merged/retired by the system
  kind           text not null default 'inferred' check (kind in ('asserted','inferred')),
  status         text not null default 'hypothesis'
                   check (status in ('hypothesis','confirmed','refuted','retired')),
  confidence     numeric not null default 0,
  evidence_count integer not null default 0,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  valid_until    timestamptz,                             -- expiry for time-bound facts (e.g. contract end)
  origin         text not null default 'ai' check (origin in ('ai','manual','rule')),
  superseded_by  uuid references facts(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,      -- supporting entry / measurement / correlation ids
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_facts_touch before update on facts
  for each row execute function loam_touch_updated_at();

create index facts_status_idx   on facts (status);
create index facts_category_idx on facts (category);
create index facts_kind_idx     on facts (kind);

-- --------------------------------------------------------------------------
-- correlations — earned, not assumed. Confounder-checked before surfacing.
-- --------------------------------------------------------------------------
create table correlations (
  id           uuid primary key default gen_random_uuid(),
  metric_a     text not null,
  metric_b     text not null,
  method       text not null default 'pearson',
  coefficient  numeric,
  lag_days     integer not null default 0,
  sample_size  integer,
  significance numeric,                                   -- p-value or equivalent
  time_window  text,                                       -- e.g. 'last_90d' ("window" is a reserved keyword)
  status       text not null default 'candidate'
                 check (status in ('candidate','surfaced','confirmed','dismissed')),
  evidence     jsonb not null default '{}'::jsonb,        -- supporting data + confounder-check result
  detected_at  timestamptz not null default now(),
  reviewed_at  timestamptz,
  constraint correlations_pair_unique unique (metric_a, metric_b, method, lag_days)
);
create index correlations_status_idx on correlations (status);

-- --------------------------------------------------------------------------
-- surfacing_rules / surfaced_log — the object-permanence engine.
-- --------------------------------------------------------------------------
create table surfacing_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  trigger_kind text not null check (trigger_kind in ('schedule','condition','staleness','correlation')),
  definition   jsonb not null default '{}'::jsonb,        -- schedule/cron, condition query, staleness window, correlation id
  channel      text not null default 'telegram',
  cadence      text,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_surfacing_rules_touch before update on surfacing_rules
  for each row execute function loam_touch_updated_at();

create table surfaced_log (
  id           uuid primary key default gen_random_uuid(),
  rule_id      uuid references surfacing_rules(id) on delete set null,
  subject_kind text,
  subject_id   uuid,
  channel      text,
  surfaced_at  timestamptz not null default now(),
  outcome      text check (outcome in ('acted','dismissed','ignored','snoozed')),
  metadata     jsonb not null default '{}'::jsonb
);
create index surfaced_log_rule_idx on surfaced_log (rule_id);
create index surfaced_log_time_idx on surfaced_log (surfaced_at desc);

-- --------------------------------------------------------------------------
-- Row Level Security — single-user, fail-closed.
-- RLS on for every table (deny by default). The authenticated owner has full
-- access; service_role used by ingestion bypasses RLS by design.
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sources','entries','measurements','entities','edges','tags','entry_tags',
    'events','facts','correlations','surfacing_rules','surfaced_log'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);
    execute format(
      'create policy owner_all on %I for all to authenticated using (true) with check (true);', t
    );
  end loop;
end$$;
