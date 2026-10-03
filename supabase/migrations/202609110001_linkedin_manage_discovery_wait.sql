-- Companion 2.1.15 waits for LinkedIn's asynchronously rendered Manage card
-- and recognizes both admin-view and public company links inside that card.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.15', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
