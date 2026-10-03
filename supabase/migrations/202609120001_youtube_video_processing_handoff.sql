-- Companion 2.1.24 keeps the YouTube tab alive while the post-Publish dialog
-- reports an active transfer. It closes only after YouTube says processing can
-- continue server-side.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.24', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
