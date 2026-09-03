-- Companion 2.1.3 repairs upgrades from the former desktop product name by
-- recovering the paired workspace account IDs and their protected sessions.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.3', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
