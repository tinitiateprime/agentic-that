-- Require the Companion release that executes due exact-time and reusable-
-- schedule publishing jobs after they are claimed from the central queue.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.13', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
