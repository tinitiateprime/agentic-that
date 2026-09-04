-- Companion 2.1.6 durably verifies, flushes, and recovers Facebook sessions.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.6', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
