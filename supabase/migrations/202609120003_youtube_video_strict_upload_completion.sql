-- Companion 2.1.26 requires proof that the current YouTube video upload
-- reached 100% before any processing screen can complete the browser flow.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.26', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
