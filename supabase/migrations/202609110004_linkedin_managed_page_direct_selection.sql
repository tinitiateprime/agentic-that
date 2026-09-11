-- Companion 2.1.18 selects slug-based LinkedIn managed Pages through their
-- exact Manage-card link, avoiding LinkedIn's default-Page admin redirect.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.18', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
