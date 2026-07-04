-- Pin the trigger function's search_path (Supabase security linter 0011,
-- function_search_path_mutable). now() resolves from pg_catalog, which stays
-- implicitly available even with an empty search_path.
create or replace function loam_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
