-- Social Manager → automatic analytics updates. A company saves its own
-- Instagram profile and Facebook Page link once; every night the paired
-- Companion collects those posts' public numbers (likes, comments, views)
-- with the Instagram/Facebook scrapers it already has, and the website adds
-- them to the analytics. The website has no always-on server, so the nightly
-- job is queued when the Companion asks for work (companion_claim_jobs).

create table if not exists public.social_analytics_sources (
  id                      text primary key,
  workspace_id            text not null references public.platform_workspaces(id) on delete cascade,
  platform                text not null check (platform in ('instagram', 'facebook')),
  profile_url             text not null,
  enabled                 boolean not null default true,
  -- JavaScript's getTimezoneOffset() of whoever saved it (IST is -330), so
  -- "night" is the company's night.
  timezone_offset_minutes integer not null default 0 check (timezone_offset_minutes between -840 and 840),
  last_job_id             text,
  last_queued_at          timestamptz,
  last_imported_job_id    text,
  last_synced_at          timestamptz,
  last_status             text not null default 'never'
    check (last_status in ('never', 'queued', 'running', 'synced', 'failed')),
  last_message            text,
  created_by              text references public.platform_users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (workspace_id, platform)
);

alter table public.social_analytics_sources enable row level security;
revoke all on public.social_analytics_sources from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.social_analytics_sources from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.social_analytics_sources from authenticated;
  end if;
end $$;

-- The scrape request for one source. Kept in one place so the website's
-- "Update now" sends exactly the same thing (see social-analytics-sync.js).
create or replace function private.social_analytics_sync_payload(source public.social_analytics_sources)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'source', 'social-analytics',
    'sourceId', source.id,
    'mode', 'profile_url',
    'query', source.profile_url,
    'profile_type', 'page',
    'collection_mode', 'latest',
    'max_results', 50,
    'recent_days', 365,
    'skip_comments', true,
    'timezone_offset_minutes', source.timezone_offset_minutes
  )
$$;

-- Queues at most one update a day per source: during the company's night
-- (1-5 am), or as soon as the Companion is back if the last one is more than
-- a day and a half old. Returns how many were queued.
create or replace function private.queue_social_analytics_syncs(p_workspace_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.social_analytics_sources%rowtype;
  local_hour integer;
  new_job_id text;
  inserted integer;
  queued integer := 0;
begin
  for source in
    select * from public.social_analytics_sources s
     where s.workspace_id = p_workspace_id
       and s.enabled
       and (s.last_queued_at is null or s.last_queued_at < now() - interval '20 hours')
     for update skip locked
  loop
    local_hour := extract(hour from (now() at time zone 'UTC') - make_interval(mins => source.timezone_offset_minutes));
    continue when source.last_queued_at is not null
      and local_hour not between 1 and 4
      and source.last_queued_at > now() - interval '36 hours';
    continue when source.last_job_id is not null and exists (
      select 1 from public.jobs j
       where j.id = source.last_job_id
         and j.status in ('queued', 'waiting_for_companion', 'claimed', 'running', 'cancel_requested'));

    new_job_id := 'scrapejob_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.jobs(id, workspace_id, job_type, platform, idempotency_key, priority, payload, max_attempts)
    values (
      new_job_id, source.workspace_id, 'scrape.' || source.platform, source.platform,
      'social-analytics:' || source.id || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      50, private.social_analytics_sync_payload(source), 2)
    on conflict (workspace_id, idempotency_key) do nothing;
    get diagnostics inserted = row_count;
    continue when inserted = 0;

    insert into public.job_events(job_id, workspace_id, event_type, status, message)
    values (new_job_id, source.workspace_id, 'job.queued', 'queued', 'Nightly Social Manager analytics update.');
    update public.social_analytics_sources set
      last_job_id = new_job_id, last_queued_at = now(), last_status = 'queued',
      last_message = 'Waiting for the Companion.', updated_at = now()
     where id = source.id;
    queued := queued + 1;
  end loop;
  return queued;
end
$$;

revoke all on function private.social_analytics_sync_payload(public.social_analytics_sources) from public;
revoke all on function private.queue_social_analytics_syncs(text) from public;

-- The Companion's job hand-out, unchanged except for the block that queues
-- the updates above. Generated from the live definition.
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

  with candidates as (
    select j.id
      from public.jobs j
     where j.workspace_id = device.workspace_id
       and j.status in ('queued', 'waiting_for_companion')
       and j.not_before <= now()
       and j.attempt_count < j.max_attempts
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
