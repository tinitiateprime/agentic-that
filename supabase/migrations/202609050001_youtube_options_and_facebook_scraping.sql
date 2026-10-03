-- Earlier Companions hardcode a video audience and public visibility. Require
-- the version that honors each queued video's explicit settings.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.7', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
