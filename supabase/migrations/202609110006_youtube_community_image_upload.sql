-- Companion 2.1.20 makes YouTube Community image uploads reliable for large
-- posters and current image-editor/preview variants.
insert into public.job_control_settings(key, value, updated_at)
values ('minimum_companion_version', '2.1.20', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
