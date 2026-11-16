-- Reddit accounts log in through the Companion now, so the heartbeat records
-- them like the other apps (it skipped any app not on its list, so Reddit
-- logins never showed as connected). Reddit uses the external browser.
-- Generated from the live definition with only the two app lists changed.

CREATE OR REPLACE FUNCTION public.companion_heartbeat(p_token text, p_instance_id text DEFAULT NULL::text, p_version text DEFAULT NULL::text, p_runtime_status text DEFAULT 'ready'::text, p_update_status text DEFAULT 'idle'::text, p_last_error text DEFAULT NULL::text, p_platform text DEFAULT NULL::text, p_architecture text DEFAULT NULL::text, p_secure_storage boolean DEFAULT false, p_accounts jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if account->>'platform' in ('instagram', 'facebook', 'x', 'linkedin', 'youtube', 'reddit')
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
            when account->>'platform' in ('x', 'youtube', 'reddit') or account->>'executionEngine' = 'external_browser'
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
$function$;

-- create or replace keeps existing grants.
