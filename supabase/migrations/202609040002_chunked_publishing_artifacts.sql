-- Companion 2.1.4 assembles protected large publishing media from verified parts.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.4', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
