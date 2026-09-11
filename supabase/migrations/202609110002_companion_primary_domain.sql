-- Companion 2.1.16 uses the primary AgenticThat domain for its embedded
-- dashboard and publishing extension instead of the legacy Netlify hostname.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.16', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
