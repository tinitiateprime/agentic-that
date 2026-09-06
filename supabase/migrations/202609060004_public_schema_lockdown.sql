-- Supabase Data API lockdown. The product's server connection remains the only
-- direct database writer. Companion RPC grants are restored explicitly below.

-- Webhook providers retry deliveries. Remove historical duplicates before
-- enforcing the same idempotency key under concurrent serverless requests.
delete from public.messages duplicate
using public.messages retained
where duplicate.id > retained.id
  and duplicate.business_id = retained.business_id
  and coalesce(duplicate.provider, '') = coalesce(retained.provider, '')
  and duplicate.provider_id = retained.provider_id
  and duplicate.provider_id is not null;

create unique index if not exists messages_provider_delivery_unique_idx
  on public.messages(business_id, coalesce(provider, ''), provider_id)
  where provider_id is not null;

do $$
declare
  table_row record;
begin
  for table_row in
    select schemaname, tablename
      from pg_tables
     where schemaname = 'public'
  loop
    execute format('alter table %I.%I enable row level security', table_row.schemaname, table_row.tablename);
    execute format('revoke all on table %I.%I from public', table_row.schemaname, table_row.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I.%I from anon', table_row.schemaname, table_row.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I.%I from authenticated', table_row.schemaname, table_row.tablename);
    end if;
  end loop;
end $$;

do $$
begin
  revoke all on all sequences in schema public from public;
  revoke execute on all functions in schema public from public;
  alter default privileges in schema public revoke all on tables from public;
  alter default privileges in schema public revoke all on sequences from public;
  alter default privileges in schema public revoke execute on functions from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke create on schema public from anon;
    revoke all on all sequences in schema public from anon;
    revoke execute on all functions in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
    alter default privileges in schema public revoke execute on functions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke create on schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
    revoke execute on all functions in schema public from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;
    alter default privileges in schema public revoke execute on functions from authenticated;
  end if;
end $$;

-- These four SECURITY DEFINER functions validate a one-time pairing code or a
-- hashed Companion token and are the only supported browser-role DB surface.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.companion_redeem_pairing(text, text, text, text, text, boolean) to anon;
    grant execute on function public.companion_heartbeat(text, text, text, text, text, text, text, text, boolean, jsonb) to anon;
    grant execute on function public.companion_claim_jobs(text, text, integer) to anon;
    grant execute on function public.companion_update_job(text, text, text, text, jsonb, text, boolean, jsonb, jsonb, boolean) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.companion_redeem_pairing(text, text, text, text, text, boolean) to authenticated;
    grant execute on function public.companion_heartbeat(text, text, text, text, text, text, text, text, boolean, jsonb) to authenticated;
    grant execute on function public.companion_claim_jobs(text, text, integer) to authenticated;
    grant execute on function public.companion_update_job(text, text, text, text, jsonb, text, boolean, jsonb, jsonb, boolean) to authenticated;
  end if;
end $$;
