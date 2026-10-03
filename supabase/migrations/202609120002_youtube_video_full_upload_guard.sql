-- Companion 2.1.25 waits for YouTube's video upload to finish before closing
-- Studio. A transiently missing upload dialog is never treated as completion.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.25', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
