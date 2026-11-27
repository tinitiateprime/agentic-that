-- Social Manager inbox → Instagram. A company can now turn on checks for a
-- connected Instagram account: the Companion opens instagram.com/notifications
-- read-only and reads the comments, replies and mentions Instagram lists
-- there. Instagram checks need Companion 2.14.0; older Companions are never
-- handed one.

alter table public.social_inbox_sources drop constraint if exists social_inbox_sources_platform_check;
alter table public.social_inbox_sources add constraint social_inbox_sources_platform_check
  check (platform in ('youtube', 'linkedin', 'x', 'facebook', 'instagram'));

create or replace function private.social_inbox_min_version(p_platform text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_platform
    when 'youtube' then '2.9.0'
    when 'linkedin' then '2.10.0'
    when 'x' then '2.11.0'
    when 'facebook' then '2.12.0'
    when 'instagram' then '2.14.0'
    else '999.0.0'
  end
$$;
