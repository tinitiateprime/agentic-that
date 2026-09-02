-- AgenticThat Companion control plane.
-- The web application writes through its server-side Postgres connection.
-- Companion devices can only use the explicitly granted token-authenticated RPCs.

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.companion_pairing_challenges (
  id                    text primary key,
  workspace_id          text not null references public.platform_workspaces(id) on delete cascade,
  code_hash              text not null unique,
  label                  text not null,
  companion_instance_id text,
  registered_by_user_id text references public.platform_users(id) on delete set null,
  expires_at             timestamptz not null,
  created_at             timestamptz not null default now()
);

create table if not exists public.companion_devices (
  id                    text primary key,
  workspace_id          text not null references public.platform_workspaces(id) on delete cascade,
  label                  text not null,
  companion_instance_id text not null,
  token_hash             text not null unique,
  status                 text not null default 'offline',
  runtime_status         text not null default 'starting',
  update_status          text not null default 'unknown',
  version                text,
  platform               text,
  architecture           text,
  secure_storage         boolean not null default false,
  last_error             text,
  last_seen_at           timestamptz,
  paired_at              timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  revoked_at             timestamptz,
  registered_by_user_id text references public.platform_users(id) on delete set null,
  constraint companion_devices_status_check
    check (status in ('offline', 'online', 'updating', 'error')),
  constraint companion_devices_runtime_status_check
    check (runtime_status in ('starting', 'ready', 'busy', 'error'))
);

create unique index if not exists companion_devices_workspace_instance_active_idx
  on public.companion_devices(workspace_id, companion_instance_id)
  where revoked_at is null;
create index if not exists companion_devices_workspace_seen_idx
  on public.companion_devices(workspace_id, last_seen_at desc);

create table if not exists public.social_accounts (
  id                    text primary key,
  workspace_id          text not null references public.platform_workspaces(id) on delete cascade,
  companion_device_id   text references public.companion_devices(id) on delete set null,
  platform              text not null,
  display_name          text not null,
  handle                 text not null default '',
  login_identifier      text not null default '',
  enabled                boolean not null default true,
  credential_configured boolean not null default false,
  session_status         text not null default 'reconnect_required',
  safety_status          text not null default 'healthy',
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint social_accounts_platform_check
    check (platform in ('instagram', 'facebook', 'x', 'linkedin', 'youtube')),
  constraint social_accounts_session_status_check
    check (session_status in ('connected', 'reconnect_required', 'unknown'))
);

drop index if exists public.social_accounts_workspace_platform_handle_idx;
create unique index if not exists social_accounts_workspace_platform_handle_nonempty_idx
  on public.social_accounts(workspace_id, platform, lower(handle))
  where nullif(trim(handle), '') is not null;
create index if not exists social_accounts_workspace_idx
  on public.social_accounts(workspace_id, platform, updated_at desc);

create table if not exists public.jobs (
  id                      text primary key,
  workspace_id            text not null references public.platform_workspaces(id) on delete cascade,
  job_type                text not null,
  platform                text,
  account_id              text references public.social_accounts(id) on delete set null,
  requested_by_user_id    text references public.platform_users(id) on delete set null,
  assigned_device_id      text references public.companion_devices(id) on delete set null,
  idempotency_key         text not null,
  priority                integer not null default 100,
  status                  text not null default 'queued',
  payload                 jsonb not null default '{}'::jsonb,
  progress                jsonb not null default '{}'::jsonb,
  message                 text,
  error                   jsonb,
  attempt_count           integer not null default 0,
  max_attempts            integer not null default 3,
  lease_expires_at        timestamptz,
  final_action_started_at timestamptz,
  not_before              timestamptz not null default now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint jobs_type_check
    check (job_type in ('publish', 'scrape.instagram', 'scrape.facebook')),
  constraint jobs_platform_check
    check (platform is null or platform in ('instagram', 'facebook', 'x', 'linkedin', 'youtube')),
  constraint jobs_status_check
    check (status in (
      'queued', 'waiting_for_companion', 'claimed', 'running',
      'opening_platform', 'uploading', 'publishing',
      'success', 'failed', 'uncertain', 'reconnect_required',
      'cancel_requested', 'cancelled'
    )),
  constraint jobs_attempts_check
    check (attempt_count >= 0 and max_attempts between 1 and 10),
  unique (workspace_id, idempotency_key)
);

create index if not exists jobs_claim_idx
  on public.jobs(status, not_before, priority desc, created_at)
  where status in ('queued', 'waiting_for_companion');
create index if not exists jobs_workspace_idx
  on public.jobs(workspace_id, created_at desc);
create index if not exists jobs_device_lease_idx
  on public.jobs(assigned_device_id, lease_expires_at)
  where assigned_device_id is not null;

create table if not exists public.job_events (
  id          bigint generated always as identity primary key,
  job_id      text not null references public.jobs(id) on delete cascade,
  workspace_id text not null references public.platform_workspaces(id) on delete cascade,
  device_id   text references public.companion_devices(id) on delete set null,
  event_type  text not null,
  status      text,
  message     text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists job_events_job_idx on public.job_events(job_id, id);
create index if not exists job_events_workspace_idx on public.job_events(workspace_id, created_at desc);

create table if not exists public.job_results (
  job_id       text primary key references public.jobs(id) on delete cascade,
  workspace_id text not null references public.platform_workspaces(id) on delete cascade,
  outcome      text not null,
  result       jsonb not null default '{}'::jsonb,
  error        jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint job_results_outcome_check check (outcome in ('SUCCESS', 'FAILED', 'UNCERTAIN', 'CANCELLED'))
);

create table if not exists public.job_artifacts (
  id           text primary key,
  job_id       text not null references public.jobs(id) on delete cascade,
  workspace_id text not null references public.platform_workspaces(id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  byte_size    bigint,
  sha256       text,
  created_at   timestamptz not null default now(),
  unique (job_id, storage_bucket, storage_path)
);

create table if not exists public.job_control_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

insert into public.job_control_settings(key, value)
values ('minimum_companion_version', '2.0.0')
on conflict (key) do nothing;

alter table public.companion_pairing_challenges enable row level security;
alter table public.companion_devices enable row level security;
alter table public.social_accounts enable row level security;
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;
alter table public.job_results enable row level security;
alter table public.job_artifacts enable row level security;
alter table public.job_control_settings enable row level security;

revoke all on table public.companion_pairing_challenges from anon, authenticated;
revoke all on table public.companion_devices from anon, authenticated;
revoke all on table public.social_accounts from anon, authenticated;
revoke all on table public.jobs from anon, authenticated;
revoke all on table public.job_events from anon, authenticated;
revoke all on table public.job_results from anon, authenticated;
revoke all on table public.job_artifacts from anon, authenticated;
revoke all on table public.job_control_settings from anon, authenticated;

create or replace function private.companion_token_hash(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(value, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.companion_public(device public.companion_devices)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', device.id,
    'workspaceId', device.workspace_id,
    'label', device.label,
    'companionInstanceId', device.companion_instance_id,
    'status', case
      when device.revoked_at is not null then 'offline'
      when device.last_seen_at is null or device.last_seen_at < now() - interval '90 seconds' then 'offline'
      when device.update_status in ('checking', 'downloading', 'downloaded', 'applying') then 'updating'
      when device.runtime_status = 'error' then 'error'
      else 'online'
    end,
    'version', device.version,
    'runtimeStatus', device.runtime_status,
    'updateStatus', device.update_status,
    'lastError', device.last_error,
    'platform', device.platform,
    'architecture', device.architecture,
    'secureStorage', device.secure_storage,
    'lastSeenAt', device.last_seen_at,
    'pairedAt', device.paired_at,
    'updatedAt', device.updated_at
  )
$$;

create or replace function private.semver_at_least(current_version text, minimum_version text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  current_parts integer[];
  minimum_parts integer[];
begin
  if coalesce(current_version, '') !~ '^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$'
     or coalesce(minimum_version, '') !~ '^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$' then
    return false;
  end if;
  current_parts := string_to_array(split_part(split_part(current_version, '-', 1), '+', 1), '.')::integer[];
  minimum_parts := string_to_array(split_part(split_part(minimum_version, '-', 1), '+', 1), '.')::integer[];
  return current_parts[1] > minimum_parts[1]
    or (current_parts[1] = minimum_parts[1] and current_parts[2] > minimum_parts[2])
    or (current_parts[1] = minimum_parts[1] and current_parts[2] = minimum_parts[2] and current_parts[3] >= minimum_parts[3]);
end
$$;

create or replace function public.companion_redeem_pairing(
  p_pairing_code text,
  p_instance_id text,
  p_version text default null,
  p_platform text default null,
  p_architecture text default null,
  p_secure_storage boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge public.companion_pairing_challenges%rowtype;
  device public.companion_devices%rowtype;
  raw_token text;
  next_id text;
begin
  if length(coalesce(p_pairing_code, '')) < 32 or length(trim(coalesce(p_instance_id, ''))) < 8 then
    raise exception 'This one-time pairing request is invalid or expired.' using errcode = '28000';
  end if;

  delete from public.companion_pairing_challenges where expires_at <= now();
  select * into challenge
    from public.companion_pairing_challenges
   where code_hash = private.companion_token_hash(p_pairing_code)
   for update;

  if not found or challenge.expires_at <= now() then
    raise exception 'This one-time pairing request is invalid or expired.' using errcode = '28000';
  end if;
  if challenge.companion_instance_id is not null
     and challenge.companion_instance_id <> left(trim(p_instance_id), 120) then
    raise exception 'This pairing request belongs to a different Companion.' using errcode = '28000';
  end if;

  delete from public.companion_pairing_challenges where id = challenge.id;
  update public.companion_devices
     set revoked_at = now(), status = 'offline', updated_at = now()
   where workspace_id = challenge.workspace_id
     and companion_instance_id = left(trim(p_instance_id), 120)
     and revoked_at is null;

  raw_token := translate(encode(extensions.gen_random_bytes(48), 'base64'), E'+/=\n\r', '-_');
  next_id := 'companion_' || replace(extensions.gen_random_uuid()::text, '-', '');
  insert into public.companion_devices(
    id, workspace_id, label, companion_instance_id, token_hash,
    version, platform, architecture, secure_storage, registered_by_user_id
  ) values (
    next_id, challenge.workspace_id, challenge.label, left(trim(p_instance_id), 120),
    private.companion_token_hash(raw_token), left(p_version, 40), left(p_platform, 40),
    left(p_architecture, 40), coalesce(p_secure_storage, false), challenge.registered_by_user_id
  ) returning * into device;

  insert into public.job_events(job_id, workspace_id, device_id, event_type, status, message)
  select id, workspace_id, device.id, 'device.available', status, 'A workspace Companion was paired.'
    from public.jobs
   where workspace_id = device.workspace_id and status = 'waiting_for_companion'
   order by created_at desc limit 1;

  return jsonb_build_object('token', raw_token, 'companion', private.companion_public(device));
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
          'executionEngine', 'companion',
          'safetyMode', coalesce(account->>'safetyMode', ''),
          'twoFactorEnabled', coalesce((account->>'twoFactorEnabled')::boolean, false)
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
      where public.social_accounts.workspace_id = device.workspace_id;
    end if;
  end loop;

  update public.social_accounts stored set
    credential_configured = false,
    session_status = 'reconnect_required',
    updated_at = now()
  where stored.workspace_id = device.workspace_id
    and stored.companion_device_id = device.id
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

create or replace function public.companion_update_job(
  p_token text,
  p_instance_id text,
  p_job_id text,
  p_status text,
  p_progress jsonb default '{}'::jsonb,
  p_message text default null,
  p_retry boolean default false,
  p_result jsonb default null,
  p_error jsonb default null,
  p_final_action boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device public.companion_devices%rowtype;
  job public.jobs%rowtype;
  next_status text;
  outcome text;
begin
  select * into device from public.companion_devices
   where token_hash = private.companion_token_hash(p_token) and revoked_at is null;
  if not found then raise exception 'This Companion pairing is no longer valid.' using errcode = '28000'; end if;
  if device.companion_instance_id <> left(trim(coalesce(p_instance_id, '')), 120) then
    raise exception 'This Companion token belongs to a different installation.' using errcode = '28000';
  end if;

  select * into job from public.jobs
   where id = p_job_id and workspace_id = device.workspace_id for update;
  if not found then raise exception 'This Companion job was not found.' using errcode = 'P0002'; end if;

  if job.status = 'cancel_requested' and p_status not in ('cancelled', 'uncertain', 'success') then
    if coalesce(p_final_action, false) then
      update public.jobs set
        final_action_started_at = coalesce(final_action_started_at, now()),
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
      where id = job.id;
      insert into public.job_events(job_id, workspace_id, device_id, event_type, status, message)
      values (job.id, job.workspace_id, device.id, 'job.final_action', job.status, 'Final platform action was observed while cancellation was pending.');
    end if;
    return jsonb_build_object('id', job.id, 'status', job.status, 'cancelRequested', true);
  end if;
  if job.status in ('success', 'cancelled') then
    return jsonb_build_object('id', job.id, 'status', job.status);
  end if;
  if (job.assigned_device_id is distinct from device.id or job.lease_expires_at <= now())
     and not (job.status in ('failed', 'uncertain') and p_status = 'success') then
    raise exception 'This Companion no longer holds the job lease.' using errcode = '42501';
  end if;
  if p_status not in ('running', 'opening_platform', 'uploading', 'publishing', 'success', 'failed', 'uncertain', 'reconnect_required', 'cancelled') then
    raise exception 'The Companion job status is invalid.' using errcode = '22023';
  end if;

  next_status := p_status;
  if p_status = 'failed' and coalesce(p_retry, false) and job.attempt_count < job.max_attempts
     and job.final_action_started_at is null then
    next_status := 'queued';
  end if;

  update public.jobs set
    status = next_status,
    progress = coalesce(p_progress, '{}'::jsonb),
    message = nullif(left(trim(p_message), 1000), ''),
    error = p_error,
    final_action_started_at = case when coalesce(p_final_action, false) then coalesce(final_action_started_at, now()) else final_action_started_at end,
    assigned_device_id = case when next_status = 'queued' then null else assigned_device_id end,
    lease_expires_at = case when next_status in ('success', 'failed', 'uncertain', 'reconnect_required', 'cancelled', 'queued') then null else now() + interval '5 minutes' end,
    completed_at = case when next_status in ('success', 'failed', 'uncertain', 'cancelled') then now() else null end,
    updated_at = now()
  where id = job.id returning * into job;

  update public.companion_devices set
    status = 'online', runtime_status = case when next_status in ('running', 'opening_platform', 'uploading', 'publishing') then 'busy' else 'ready' end,
    last_seen_at = now(), updated_at = now()
  where id = device.id;

  insert into public.job_events(job_id, workspace_id, device_id, event_type, status, message, details)
  values (job.id, job.workspace_id, device.id, 'job.status', job.status, job.message, coalesce(p_progress, '{}'::jsonb));

  if job.status in ('success', 'failed', 'uncertain', 'cancelled') then
    outcome := case job.status when 'success' then 'SUCCESS' when 'uncertain' then 'UNCERTAIN' when 'cancelled' then 'CANCELLED' else 'FAILED' end;
    insert into public.job_results(job_id, workspace_id, outcome, result, error)
    values (job.id, job.workspace_id, outcome, coalesce(p_result, '{}'::jsonb), p_error)
    on conflict (job_id) do update set outcome = excluded.outcome, result = excluded.result, error = excluded.error, updated_at = now();
  end if;

  return jsonb_build_object(
    'id', job.id, 'workspaceId', job.workspace_id, 'type', job.job_type,
    'status', job.status, 'progress', job.progress, 'message', job.message,
    'attemptCount', job.attempt_count, 'leaseExpiresAt', job.lease_expires_at,
    'cancelRequested', job.status = 'cancel_requested'
  );
end
$$;

revoke all on function public.companion_redeem_pairing(text, text, text, text, text, boolean) from public;
revoke all on function public.companion_heartbeat(text, text, text, text, text, text, text, text, boolean, jsonb) from public;
revoke all on function private.companion_token_hash(text) from public;
revoke all on function private.companion_public(public.companion_devices) from public;
revoke all on function private.semver_at_least(text, text) from public;
revoke all on function public.companion_claim_jobs(text, text, integer) from public;
revoke all on function public.companion_update_job(text, text, text, text, jsonb, text, boolean, jsonb, jsonb, boolean) from public;
grant execute on function public.companion_redeem_pairing(text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.companion_heartbeat(text, text, text, text, text, text, text, text, boolean, jsonb) to anon, authenticated;
grant execute on function public.companion_claim_jobs(text, text, integer) to anon, authenticated;
grant execute on function public.companion_update_job(text, text, text, text, jsonb, text, boolean, jsonb, jsonb, boolean) to anon, authenticated;

comment on table public.jobs is 'Durable Supabase control queue. Browser sessions and credentials never belong in payload.';
comment on table public.social_accounts is 'Account metadata only. Browser cookies and credentials remain inside Companion.';
