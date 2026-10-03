-- Companion 2.1.19 verifies that LinkedIn followed the selected Manage-card
-- link and falls back only to that exact, provider-supplied destination.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.19', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
