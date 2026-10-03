-- Companion 2.1.28 closes the YouTube browser as soon as the active upload
-- reaches YouTube Studio's Video processing dialog.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.28', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
