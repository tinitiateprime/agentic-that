-- Reddit now publishes through the Companion like every other app (its
-- logged-in browser), not Zernio. The Companion's job hand-out therefore stops
-- skipping Reddit jobs; accounts set to the "api" engine are still skipped.
-- Generated from the live definition with only that one condition removed.

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

-- create or replace keeps existing grants.
