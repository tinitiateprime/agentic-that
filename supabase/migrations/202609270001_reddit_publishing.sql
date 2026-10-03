-- Reddit publishing. Reddit accounts publish only from the platform server
-- through Zernio (execution engine 'api'); the Companion never handles them.

alter table public.social_accounts drop constraint if exists social_accounts_platform_check;
alter table public.social_accounts add constraint social_accounts_platform_check
  check (platform in ('instagram', 'facebook', 'x', 'linkedin', 'youtube', 'reddit'));

alter table public.jobs drop constraint if exists jobs_platform_check;
alter table public.jobs add constraint jobs_platform_check
  check (platform is null or platform in ('instagram', 'facebook', 'x', 'linkedin', 'youtube', 'reddit'));

-- OAuth grants per publishing account. Tokens are encrypted by the application;
-- this table is accessible only to the platform server role.
create table if not exists public.publishing_reddit_connections (
  workspace_id text not null references public.platform_workspaces(id) on delete cascade,
  account_id text not null,
  reddit_user_id text not null,
  reddit_username text not null,
  refresh_token_ciphertext text not null,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  granted_scopes text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, account_id)
);

alter table public.publishing_reddit_connections enable row level security;
revoke all on public.publishing_reddit_connections from public, anon, authenticated;

create index if not exists jobs_api_publish_due_idx
  on public.jobs(platform, not_before)
  where job_type = 'publish' and status in ('queued', 'waiting_for_companion');

-- The Companion must never claim a Reddit job, report a Reddit account, or
-- mark a server-published account for re-login.
create or replace function public.companion_claim_jobs(
  p_token text,
  p_instance_id text,
  p_limit integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
              and account.platform <> 'reddit'
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
$$;

create or replace function public.companion_heartbeat(
  p_token text,
  p_instance_id text default null,
  p_version text default null,
  p_runtime_status text default 'ready',
  p_update_status text default 'idle',
  p_last_error text default null,
  p_platform text default null,
  p_architecture text default null,
  p_secure_storage boolean default false,
  p_accounts jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device public.companion_devices%rowtype;
  account jsonb;
  managed_pages jsonb;
  login_required integer;
begin
  select * into device
    from public.companion_devices
   where token_hash = private.companion_token_hash(p_token) and revoked_at is null
   for update;
  if not found then
    raise exception 'This Companion pairing is no longer valid.' using errcode = '28000';
  end if;
  if jsonb_typeof(coalesce(p_accounts, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_accounts, '[]'::jsonb)) > 100 then
    raise exception 'The Companion account inventory is invalid.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_instance_id, '')), '') is not null
     and device.companion_instance_id <> left(trim(p_instance_id), 120) then
    raise exception 'This Companion token belongs to a different installation.' using errcode = '28000';
  end if;

  update public.companion_devices set
    status = case when p_runtime_status = 'error' then 'error' else 'online' end,
    version = coalesce(nullif(left(trim(p_version), 40), ''), version),
    runtime_status = case when p_runtime_status in ('starting', 'ready', 'busy', 'error') then p_runtime_status else runtime_status end,
    update_status = case when p_update_status in ('unsupported', 'idle', 'checking', 'downloading', 'downloaded', 'applying', 'error') then p_update_status else update_status end,
    last_error = nullif(left(trim(p_last_error), 500), ''),
    platform = coalesce(nullif(left(trim(p_platform), 40), ''), platform),
    architecture = coalesce(nullif(left(trim(p_architecture), 40), ''), architecture),
    secure_storage = coalesce(p_secure_storage, false),
    last_seen_at = now(), updated_at = now()
  where id = device.id returning * into device;

  for account in select value from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    if account->>'platform' in ('instagram', 'facebook', 'x', 'linkedin', 'youtube')
       and length(trim(coalesce(account->>'id', ''))) > 0 then
      managed_pages := case
        when account->>'platform' = 'linkedin'
          and jsonb_typeof(account->'linkedinManagedPages') = 'array'
          and jsonb_array_length(account->'linkedinManagedPages') <= 100
        then account->'linkedinManagedPages'
        else '[]'::jsonb
      end;
      insert into public.social_accounts(
        id, workspace_id, companion_device_id, platform, display_name, handle,
        login_identifier, enabled, credential_configured, session_status, safety_status, metadata
      ) values (
        left(account->>'id', 180), device.workspace_id, device.id, account->>'platform',
        left(coalesce(nullif(trim(account->>'displayName'), ''), nullif(trim(account->>'handle'), ''), account->>'platform'), 120),
        left(coalesce(account->>'handle', ''), 180), left(coalesce(account->>'loginIdentifier', ''), 180),
        coalesce((account->>'enabled')::boolean, true), coalesce((account->>'credentialConfigured')::boolean, false),
        case when coalesce((account->>'credentialConfigured')::boolean, false) then 'connected' else 'reconnect_required' end,
        left(coalesce(nullif(account->>'safetyStatus', ''), 'healthy'), 60),
        jsonb_build_object(
          'executionEngine', case
            when account->>'platform' in ('x', 'youtube') or account->>'executionEngine' = 'external_browser'
              then 'external_browser'
            else 'companion'
          end,
          'safetyMode', coalesce(account->>'safetyMode', ''),
          'twoFactorEnabled', coalesce((account->>'twoFactorEnabled')::boolean, false),
          'linkedinManagedPages', managed_pages,
          'linkedinManagedPagesUpdatedAt', case
            when account->>'platform' = 'linkedin' then coalesce(account->>'linkedinManagedPagesUpdatedAt', '')
            else ''
          end
        )
      ) on conflict (id) do update set
        companion_device_id = excluded.companion_device_id,
        display_name = excluded.display_name,
        handle = excluded.handle,
        login_identifier = excluded.login_identifier,
        enabled = excluded.enabled,
        credential_configured = excluded.credential_configured,
        session_status = excluded.session_status,
        safety_status = excluded.safety_status,
        metadata = excluded.metadata,
        updated_at = now()
      where public.social_accounts.workspace_id = device.workspace_id
        and coalesce(public.social_accounts.metadata->>'executionEngine', '') <> 'api';
    end if;
  end loop;

  update public.social_accounts stored set
    credential_configured = false,
    session_status = 'reconnect_required',
    updated_at = now()
  where stored.workspace_id = device.workspace_id
    and stored.companion_device_id = device.id
    and coalesce(stored.metadata->>'executionEngine', '') <> 'api'
    and not exists (
      select 1
        from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) inventory
       where left(trim(coalesce(inventory->>'id', '')), 180) = stored.id
    );

  update public.jobs j set
    status = 'queued', message = 'The social session was reconnected. Work will continue automatically.', updated_at = now()
  where j.workspace_id = device.workspace_id and j.status = 'reconnect_required'
    and exists (select 1 from public.social_accounts a where a.id = j.account_id and a.credential_configured and a.enabled);

  select count(*)::integer into login_required
    from public.social_accounts
   where workspace_id = device.workspace_id and enabled and not credential_configured;

  return private.companion_public(device) || jsonb_build_object(
    'minimumSupportedVersion', (select value from public.job_control_settings where key = 'minimum_companion_version'),
    'accountHealth', jsonb_build_object('loginRequired', login_required)
  );
end
$$;

-- create or replace keeps existing grants; restate them for fresh databases.
revoke all on function public.companion_heartbeat(text, text, text, text, text, text, text, text, boolean, jsonb) from public;
revoke all on function public.companion_claim_jobs(text, text, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.companion_heartbeat(text, text, text, text, text, text, text, text, boolean, jsonb) to anon;
    grant execute on function public.companion_claim_jobs(text, text, integer) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.companion_heartbeat(text, text, text, text, text, text, text, text, boolean, jsonb) to authenticated;
    grant execute on function public.companion_claim_jobs(text, text, integer) to authenticated;
  end if;
end $$;
