-- Companion 2.1.17 follows LinkedIn's canonical numeric Page-admin routes and
-- prevents stale publishing jobs from erasing a newer managed-Page discovery.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.17', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
