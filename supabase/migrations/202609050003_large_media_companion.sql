-- Companion 2.1.8 assigns media from the Companion's local filesystem through
-- Chromium CDP. Earlier versions fail when Playwright relays files over 50 MB.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.8', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
