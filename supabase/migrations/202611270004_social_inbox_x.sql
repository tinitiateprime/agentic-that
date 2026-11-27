-- Social Manager inbox → X. A company can now turn on checks for a connected
-- X account: the Companion reads, read-only, the replies and mentions on the
-- account's Mentions tab. X checks need Companion 2.11.0; the job hand-out
-- already asks private.social_inbox_min_version, so older Companions are
-- never handed one.

alter table public.social_inbox_sources drop constraint if exists social_inbox_sources_platform_check;
alter table public.social_inbox_sources add constraint social_inbox_sources_platform_check
  check (platform in ('youtube', 'linkedin', 'x'));

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
    else '999.0.0'
  end
$$;
