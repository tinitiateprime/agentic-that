-- Audit columns on every application table: who created and who last updated
-- each row, and when. They are separate from the existing created_at /
-- updated_at columns on purpose: several of those drive lease and retry logic
-- (stuck-job recovery, queued-email retries), and existing created_by /
-- updated_by columns hold user ids that code filters on.
--
--   created_by_username   login (email) of the user who inserted the row
--   created_datetime      when the row was inserted
--   updated_by_username   login (email) of the user who last changed the row
--   updated_datetime      when the row was last changed
--
-- A trigger owns all four, so no INSERT/UPDATE in the app has to set them. The
-- acting user comes from the transaction-local setting app.username (read in
-- agentic_that.audit_stamp), which the
-- app's database clients set for writes made during a signed-in request
-- (lib/audit-context.js). Webhooks, background jobs and Companion RPCs have no
-- signed-in user and are recorded as 'system'.

create schema if not exists agentic_that;

-- Self-contained on purpose: it runs with the privileges of whoever writes
-- (including Companion RPC roles), so it must not call other restricted
-- functions. Firing a trigger does not check EXECUTE on the trigger function.
create or replace function agentic_that.audit_stamp()
returns trigger
language plpgsql
as $$
declare
  actor text := coalesce(nullif(current_setting('app.username', true), ''), 'system');
begin
  if tg_op = 'INSERT' then
    new.created_by_username := coalesce(new.created_by_username, actor);
    new.created_datetime := coalesce(new.created_datetime, now());
    new.updated_by_username := coalesce(new.updated_by_username, new.created_by_username);
    new.updated_datetime := coalesce(new.updated_datetime, new.created_datetime);
  else
    -- Creation details never change after insert.
    new.created_by_username := old.created_by_username;
    new.created_datetime := old.created_datetime;
    -- Respect an explicit value (e.g. a data copy); otherwise stamp the actor.
    if new.updated_by_username is not distinct from old.updated_by_username then
      new.updated_by_username := actor;
    end if;
    if new.updated_datetime is not distinct from old.updated_datetime then
      new.updated_datetime := now();
    end if;
  end if;
  return new;
end
$$;

-- Add the columns and trigger to one table. Existing rows are backfilled from
-- created_at / updated_at where the table has them; who made them is unknown,
-- so their usernames stay null. Safe to run repeatedly.
create or replace function agentic_that.enable_audit(target regclass)
returns boolean
language plpgsql
as $$
declare
  has_created_at boolean;
  has_updated_at boolean;
  already boolean;
begin
  select exists (select 1 from pg_trigger where tgrelid = target and tgname = 'zz_audit_stamp' and not tgisinternal)
    into already;
  if already then
    return false;
  end if;

  execute format('alter table %s add column if not exists created_by_username text', target);
  execute format('alter table %s add column if not exists created_datetime timestamptz', target);
  execute format('alter table %s add column if not exists updated_by_username text', target);
  execute format('alter table %s add column if not exists updated_datetime timestamptz', target);

  select exists (select 1 from pg_attribute where attrelid = target and attname = 'created_at' and not attisdropped),
         exists (select 1 from pg_attribute where attrelid = target and attname = 'updated_at' and not attisdropped)
    into has_created_at, has_updated_at;

  if has_created_at and has_updated_at then
    execute format('update %s set created_datetime = coalesce(created_datetime, created_at),
                                  updated_datetime = coalesce(updated_datetime, updated_at, created_at)
                     where created_datetime is null or updated_datetime is null', target);
  elsif has_created_at then
    execute format('update %s set created_datetime = coalesce(created_datetime, created_at),
                                  updated_datetime = coalesce(updated_datetime, created_at)
                     where created_datetime is null or updated_datetime is null', target);
  elsif has_updated_at then
    execute format('update %s set updated_datetime = coalesce(updated_datetime, updated_at)
                     where updated_datetime is null', target);
  end if;

  execute format(
    'create trigger zz_audit_stamp before insert or update on %s
       for each row execute function agentic_that.audit_stamp()', target);
  return true;
end
$$;

-- Every application table in public and agentic_that, except migration
-- bookkeeping. Re-run by scripts/migrate-platform-database.mjs after each
-- migration run, so tables added later are covered automatically.
create or replace function agentic_that.enable_audit_everywhere()
returns integer
language plpgsql
as $$
declare
  rel record;
  enabled integer := 0;
begin
  for rel in
    select c.oid::regclass as target
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')
       and not c.relispartition
       and n.nspname in ('public', 'agentic_that')
       and (n.nspname, c.relname) not in (
             ('agentic_that', 'schema_migrations'),
             ('agentic_that', 'publishing_state_migrations'),
             ('public', 'app_schema_migrations'),
             ('public', 'platform_auth_migrations'))
     order by n.nspname, c.relname
  loop
    if agentic_that.enable_audit(rel.target) then
      enabled := enabled + 1;
    end if;
  end loop;
  return enabled;
end
$$;

-- Internal helpers, not browser RPCs.
revoke execute on function agentic_that.audit_stamp() from public;
revoke execute on function agentic_that.enable_audit(regclass) from public;
revoke execute on function agentic_that.enable_audit_everywhere() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function agentic_that.audit_stamp() from anon, authenticated';
    execute 'revoke execute on function agentic_that.enable_audit(regclass) from anon, authenticated';
    execute 'revoke execute on function agentic_that.enable_audit_everywhere() from anon, authenticated';
  end if;
end
$$;

select agentic_that.enable_audit_everywhere();
