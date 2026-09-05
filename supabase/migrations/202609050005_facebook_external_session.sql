-- Facebook challenges embedded Electron sessions on some devices, especially
-- macOS. Move it to the same durable external-browser profile model used for X
-- and YouTube, and require one verified reconnect for legacy embedded sessions.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.11', now())
on conflict (key) do update set value = excluded.value, updated_at = now();

update public.social_accounts
set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{executionEngine}', '"external_browser"'::jsonb, true),
    credential_configured = false,
    session_status = 'reconnect_required',
    updated_at = now()
where platform = 'facebook'
  and coalesce(metadata->>'executionEngine', 'companion') <> 'external_browser';
