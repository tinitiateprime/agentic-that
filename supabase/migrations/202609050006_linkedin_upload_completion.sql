-- Require the Companion release that keeps LinkedIn video pages open until
-- provider-side upload and processing activity has completed.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.12', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
