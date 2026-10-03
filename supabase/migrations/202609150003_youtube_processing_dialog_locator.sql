-- Companion 2.1.29 observes YouTube Studio's visible inner processing dialog
-- instead of the zero-sized outer custom element.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.29', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
