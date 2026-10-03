-- Ignore delayed lease heartbeats after a publishing attempt has already
-- reached a terminal state. A confirmed late success is still accepted for a
-- failed or uncertain attempt so provider confirmation can repair the result.
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
  if p_status not in ('running', 'opening_platform', 'uploading', 'publishing', 'success', 'failed', 'uncertain', 'reconnect_required', 'cancelled') then
    raise exception 'The Companion job status is invalid.' using errcode = '22023';
  end if;

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

  if job.status in ('success', 'cancelled', 'reconnect_required')
     or (job.status in ('failed', 'uncertain') and p_status <> 'success') then
    return jsonb_build_object('id', job.id, 'status', job.status);
  end if;
  if (job.assigned_device_id is distinct from device.id or job.lease_expires_at <= now())
     and not (job.status in ('failed', 'uncertain') and p_status = 'success') then
    raise exception 'This Companion no longer holds the job lease.' using errcode = '42501';
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
