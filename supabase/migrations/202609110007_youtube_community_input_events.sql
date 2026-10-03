-- Companion 2.1.21 emits the DOM file-input events required by YouTube's
-- Community composer after assigning media through the local CDP channel.
insert into public.job_control_settings (key, value, updated_at)
values ('minimum_companion_version', '2.1.21', now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
