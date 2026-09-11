-- Companion 2.1.23 scopes YouTube video errors to the active upload, keeps
-- Studio open while the current file is transferring, and presents ambiguous
-- post-Publish outcomes as a Studio review instead of a safe-to-retry failure.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.23', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
