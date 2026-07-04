-- app_config: service-role-only key/value store for secrets and settings.
-- RLS is enabled and FORCED with NO policy, so anon and authenticated are denied
-- entirely; only service_role (which bypasses RLS) can read or write it. This is
-- where the ingest shared secret lives, so it is never client-readable.
create table app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table app_config enable row level security;
alter table app_config force row level security;

-- Ingest shared secret for the /ingest endpoint (single-user webhook auth).
-- Random 32-byte hex. Callers present it as the `x-loam-key` header.
insert into app_config (key, value)
  values ('ingest_secret', encode(gen_random_bytes(32), 'hex'))
  on conflict (key) do nothing;

-- Registered capture / ingest channels. Adding a channel later is another row here,
-- never a schema change (the ingestion contract's core promise).
insert into sources (key, kind, label) values
  ('manual',         'capture', 'Manual quick-entry'),
  ('telegram',       'capture', 'Telegram bot'),
  ('share_sheet',    'capture', 'Android share sheet'),
  ('voice',          'capture', 'Voice note'),
  ('health_connect', 'ingest',  'Android Health Connect'),
  ('bank_csv',       'ingest',  'Bank CSV import')
on conflict (key) do nothing;
