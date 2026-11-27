-- Social Manager inbox → YouTube comments. A company turns on "YouTube
-- comments" for one of its connected YouTube accounts; every 20 minutes the
-- Companion that holds that account opens YouTube Studio in the account's
-- signed-in browser, reads the comments not yet answered, and reports them.
-- Read-only: the Companion never clicks, types or sends anything. Needs
-- Companion 2.9.0; older Companions are never handed these jobs.

alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (job_type in ('publish', 'scrape.instagram', 'scrape.facebook', 'collect.inbox'));

create table if not exists public.social_inbox_sources (
  id                    text primary key,
  workspace_id          text not null references public.platform_workspaces(id) on delete cascade,
  platform              text not null check (platform in ('youtube')),
  account_id            text not null references public.social_accounts(id) on delete cascade,
  enabled               boolean not null default true,
  last_job_id           text,
  last_queued_at        timestamptz,
  last_imported_job_id  text,
  last_collected_at     timestamptz,
  last_status           text not null default 'never'
    check (last_status in ('never', 'queued', 'running', 'collected', 'failed')),
  last_message          text,
  created_by            text references public.platform_users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id, account_id)
);

alter table public.social_inbox_sources enable row level security;
revoke all on public.social_inbox_sources from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.social_inbox_sources from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.social_inbox_sources from authenticated;
  end if;
end $$;

-- Queues a check for each turned-on source whose account this Companion may
-- use, at most every 20 minutes, never two at once. Returns how many.
create or replace function private.queue_social_inbox_collections(p_workspace_id text, p_device_id text, p_device_version text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.social_inbox_sources%rowtype;
  new_job_id text;
  inserted integer;
  queued integer := 0;
begin
  if not private.semver_at_least(p_device_version, '2.9.0') then
    return 0;
  end if;
  for source in
    select s.* from public.social_inbox_sources s
      join public.social_accounts a on a.id = s.account_id and a.workspace_id = s.workspace_id
     where s.workspace_id = p_workspace_id
       and s.enabled
       and a.enabled and a.credential_configured
       and (a.companion_device_id is null or a.companion_device_id = p_device_id)
       and (s.last_queued_at is null or s.last_queued_at < now() - interval '20 minutes')
     for update of s skip locked
  loop
    continue when source.last_job_id is not null and exists (
      select 1 from public.jobs j
       where j.id = source.last_job_id
         and j.status in ('queued', 'waiting_for_companion', 'claimed', 'running', 'cancel_requested'));

    new_job_id := 'inboxjob_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.jobs(id, workspace_id, job_type, platform, account_id, idempotency_key, priority, payload, max_attempts)
    values (
      new_job_id, source.workspace_id, 'collect.inbox', source.platform, source.account_id,
      'social-inbox:' || source.id || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD-HH24-MI'),
      40,
      jsonb_build_object('source', 'social-inbox', 'sourceId', source.id, 'kind', source.platform || '.comments', 'unansweredOnly', true),
      1)
    on conflict (workspace_id, idempotency_key) do nothing;
    get diagnostics inserted = row_count;
    continue when inserted = 0;

    insert into public.job_events(job_id, workspace_id, event_type, status, message)
    values (new_job_id, source.workspace_id, 'job.queued', 'queued', 'Social Manager inbox check.');
    update public.social_inbox_sources set
      last_job_id = new_job_id, last_queued_at = now(), last_status = 'queued',
      last_message = 'Waiting for the Companion.', updated_at = now()
     where id = source.id;
    queued := queued + 1;
  end loop;
  return queued;
end
$$;

revoke all on function private.queue_social_inbox_collections(text, text, text) from public;

-- The Companion's job hand-out: as before, plus the inbox hook above and the
-- rule that only Companion 2.9.0 or later receives inbox jobs. Generated from
-- the live definition.
CREATE OR REPLACE FUNCTION public.companion_claim_jobs(p_token text, p_instance_id text, p_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  device public.companion_devices%rowtype;
  claimed jsonb;
  maximum integer := greatest(1, least(coalesce(p_limit, 1), 5));
  minimum_version text;
begin
  select * into device from public.companion_devices
   where token_hash = private.companion_token_hash(p_token) and revoked_at is null
   for update;
  if not found then
    raise exception 'This Companion pairing is no longer valid.' using errcode = '28000';
  end if;
  if device.companion_instance_id <> left(trim(coalesce(p_instance_id, '')), 120) then
    raise exception 'This Companion token belongs to a different installation.' using errcode = '28000';
  end if;

  select value into minimum_version from public.job_control_settings where key = 'minimum_companion_version';
  if not private.semver_at_least(device.version, coalesce(minimum_version, '2.0.0')) then
    raise exception 'Update Companion to % or later to continue.', coalesce(minimum_version, '2.0.0') using errcode = '55000';
  end if;

  update public.companion_devices set status = 'online', last_seen_at = now(), updated_at = now()
   where id = device.id;

  with stale as (
    select id, workspace_id, status, final_action_started_at, attempt_count, max_attempts
      from public.jobs
     where workspace_id = device.workspace_id
       and lease_expires_at <= now()
       and status in ('claimed', 'running', 'opening_platform', 'uploading', 'publishing', 'cancel_requested')
     for update skip locked
  ), recovered as (
    update public.jobs j set
      status = case
        when stale.final_action_started_at is not null then 'uncertain'
        when stale.status = 'cancel_requested' then 'cancelled'
        when stale.attempt_count < stale.max_attempts then 'queued'
        else 'failed'
      end,
      message = case
        when stale.final_action_started_at is not null
          then 'Result is uncertain after Companion disconnected. Verify before retrying.'
        when stale.status = 'cancel_requested'
          then 'Cancelled after the Companion disconnected.'
        when stale.attempt_count < stale.max_attempts
          then 'Recovered after the previous Companion lease expired.'
        else 'The Companion stopped repeatedly before completing this job.'
      end,
      assigned_device_id = null, lease_expires_at = null,
      completed_at = case when stale.final_action_started_at is not null or stale.status = 'cancel_requested' or stale.attempt_count >= stale.max_attempts then now() else null end,
      updated_at = now()
    from stale where j.id = stale.id
    returning j.*
  )
  insert into public.job_results(job_id, workspace_id, outcome, result, error)
  select id, workspace_id,
         case when status = 'uncertain' then 'UNCERTAIN' when status = 'cancelled' then 'CANCELLED' else 'FAILED' end,
         '{}'::jsonb, jsonb_build_object('message', message, 'code', 'lease_expired')
    from recovered where status in ('uncertain', 'failed', 'cancelled')
  on conflict (job_id) do update set outcome = excluded.outcome, error = excluded.error, updated_at = now();

  update public.jobs j set status = 'reconnect_required', message = 'The saved social session needs reconnecting.', updated_at = now()
   where j.workspace_id = device.workspace_id and j.job_type = 'publish'
     and j.status in ('queued', 'waiting_for_companion')
     and exists (select 1 from public.social_accounts a where a.id = j.account_id and (not a.enabled or not a.credential_configured));

  -- Social Manager: queue today's automatic analytics updates (public post
  -- numbers for the company's own Instagram and Facebook) while this
  -- Companion is online. Never let it get in the way of handing out jobs.
  begin
    perform private.queue_social_analytics_syncs(device.workspace_id);
  exception when others then
    raise warning 'Social analytics updates were not queued: %', sqlerrm;
  end;

  -- Social Manager inbox: queue comment checks for accounts on this Companion.
  begin
    perform private.queue_social_inbox_collections(device.workspace_id, device.id, device.version);
  exception when others then
    raise warning 'Social inbox checks were not queued: %', sqlerrm;
  end;

  with candidates as (
    select j.id
      from public.jobs j
     where j.workspace_id = device.workspace_id
       and j.status in ('queued', 'waiting_for_companion')
       and j.not_before <= now()
       and j.attempt_count < j.max_attempts
       -- Older Companions don't know inbox jobs; they must never receive one.
       and (j.job_type <> 'collect.inbox' or private.semver_at_least(device.version, '2.9.0'))
       and (
         j.account_id is null
         or exists (
           select 1 from public.social_accounts account
            where account.id = j.account_id
              and account.workspace_id = j.workspace_id
              and account.enabled
              and account.credential_configured
              and coalesce(account.metadata->>'executionEngine', '') <> 'api'
              and (account.companion_device_id is null or account.companion_device_id = device.id)
         )
       )
     order by j.priority desc, j.created_at
     for update skip locked
     limit maximum
  ), updated as (
    update public.jobs j set
      status = 'claimed', assigned_device_id = device.id,
      lease_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, now()), updated_at = now()
    from candidates where j.id = candidates.id
    returning j.*
  ), events as (
    insert into public.job_events(job_id, workspace_id, device_id, event_type, status, message)
    select id, workspace_id, device.id, 'job.claimed', status, 'Claimed by the paired Companion.' from updated
    returning job_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', u.id, 'workspaceId', u.workspace_id, 'type', u.job_type,
      'platform', u.platform, 'accountId', u.account_id, 'status', u.status,
      'attemptCount', u.attempt_count, 'maxAttempts', u.max_attempts,
      'leaseExpiresAt', u.lease_expires_at, 'payload', u.payload
    ) order by u.priority desc, u.created_at
  ), '[]'::jsonb) into claimed from updated u;

  return claimed;
end
$function$;
