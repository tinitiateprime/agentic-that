-- Group Manager: each workspace's contacts (Contact Master) and the groups it
-- runs in WhatsApp, Telegram and Discord. The Companion does the work in the
-- apps and reports each result here; app logins stay on the Companion.
-- Accessed only through the authenticated website routes and the Companion's
-- paired RPC, never directly by browsers.

create table if not exists public.group_manager_contacts (
  id            text primary key,
  workspace_id  text not null references public.platform_workspaces(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  whatsapp      text not null default '',
  telegram      text not null default '',
  discord       text not null default '',
  instagram     text not null default '',
  facebook      text not null default '',
  x             text not null default '',
  reddit        text not null default '',
  linkedin      text not null default '',
  note          text not null default '',
  created_by    text references public.platform_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists group_manager_contacts_workspace_idx
  on public.group_manager_contacts (workspace_id, lower(name));

create table if not exists public.group_manager_groups (
  id                text primary key,
  workspace_id      text not null references public.platform_workspaces(id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 100),
  description       text not null default '',
  discord_guild_id  text,
  -- Per app: { state: creating|ready|failed, ref: {...app ids}, link, error, at }.
  apps              jsonb not null default '{}'::jsonb,
  created_by        text references public.platform_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists group_manager_groups_workspace_name_idx
  on public.group_manager_groups (workspace_id, lower(name));

create table if not exists public.group_manager_members (
  group_id      text not null references public.group_manager_groups(id) on delete cascade,
  contact_id    text not null,
  workspace_id  text not null references public.platform_workspaces(id) on delete cascade,
  -- Per app: { state: pending|added|invited|not-on-app|missing-id|failed|removed, detail, link, at }.
  apps          jsonb not null default '{}'::jsonb,
  added_at      timestamptz not null default now(),
  primary key (group_id, contact_id)
);
create index if not exists group_manager_members_workspace_idx
  on public.group_manager_members (workspace_id);

create table if not exists public.group_manager_messages (
  id            text primary key,
  group_id      text not null references public.group_manager_groups(id) on delete cascade,
  workspace_id  text not null references public.platform_workspaces(id) on delete cascade,
  text          text not null check (char_length(text) between 1 and 4000),
  -- Per app: { state: sending|sent|failed, error }.
  results       jsonb not null default '{}'::jsonb,
  sent_by       text references public.platform_users(id) on delete set null,
  sent_at       timestamptz not null default now()
);
create index if not exists group_manager_messages_group_recent_idx
  on public.group_manager_messages (group_id, sent_at desc);

alter table public.group_manager_contacts enable row level security;
alter table public.group_manager_groups enable row level security;
alter table public.group_manager_members enable row level security;
alter table public.group_manager_messages enable row level security;
revoke all on public.group_manager_contacts from public;
revoke all on public.group_manager_groups from public;
revoke all on public.group_manager_members from public;
revoke all on public.group_manager_messages from public;
-- The Supabase API roles exist only on Supabase-hosted databases (not on Hetzner).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.group_manager_contacts, public.group_manager_groups, public.group_manager_members, public.group_manager_messages from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.group_manager_contacts, public.group_manager_groups, public.group_manager_members, public.group_manager_messages from authenticated;
  end if;
end $$;
