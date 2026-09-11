-- Companion 2.1.22 scrolls long YouTube Community composers to their Image
-- control before attaching media, preventing assignment to an inactive input.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.22', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
