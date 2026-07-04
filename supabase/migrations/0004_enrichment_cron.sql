-- Automatic enrichment: run the enrich function every minute. It no-ops when
-- nothing is pending, so this is cheap. The shared secret is read from
-- app_config at call time, never hardcoded here.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'loam-enrich',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://eszxpusqgwwcyndzjzot.supabase.co/functions/v1/enrich',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-loam-key', (select value from app_config where key = 'ingest_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
