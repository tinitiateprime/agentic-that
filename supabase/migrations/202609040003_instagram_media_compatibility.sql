-- Companion 2.1.5 normalizes Instagram images before opening the composer.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.5', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
