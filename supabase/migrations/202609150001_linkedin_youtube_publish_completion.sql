-- Companion 2.1.27 keeps LinkedIn media sessions alive through upload safety
-- and accepts YouTube's current processing dialog as a completed upload handoff.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.27', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
