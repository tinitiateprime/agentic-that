-- Demo-ready AI Phone Front Desk. Profiles and call outcomes are isolated by
-- workspace and are only accessed through the authenticated server routes.

create table if not exists public.ai_phone_front_desk_profiles (
  workspace_id        text primary key references public.platform_workspaces(id) on delete cascade,
  created_by          text references public.platform_users(id) on delete set null,
  updated_by          text references public.platform_users(id) on delete set null,
  business_name       text not null,
  business_type       text not null default '',
  assistant_name      text not null default 'Ava',
  language            text not null default 'English',
  services            jsonb not null default '[]'::jsonb,
  business_hours      text not null default '',
  greeting            text not null default '',
  faq_notes           text not null default '',
  transfer_number     text not null default '',
  notification_email  text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.ai_phone_front_desk_calls (
  id                  text primary key,
  workspace_id        text not null references public.platform_workspaces(id) on delete cascade,
  started_by          text references public.platform_users(id) on delete set null,
  mode                text not null check (mode in ('voice', 'typed')),
  status              text not null default 'completed' check (status in ('completed', 'failed')),
  caller_name         text not null default '',
  caller_phone        text not null default '',
  reason              text not null default '',
  urgency             text not null default 'normal' check (urgency in ('low', 'normal', 'high')),
  outcome             text not null default '',
  summary             text not null default '',
  appointment         jsonb,
  handoff_requested   boolean not null default false,
  transcript          jsonb not null default '[]'::jsonb,
  duration_seconds    integer not null default 0 check (duration_seconds >= 0),
  created_at          timestamptz not null default now()
);

create index if not exists ai_phone_front_desk_calls_workspace_recent_idx
  on public.ai_phone_front_desk_calls (workspace_id, created_at desc);

alter table public.ai_phone_front_desk_profiles enable row level security;
alter table public.ai_phone_front_desk_calls enable row level security;

revoke all on table public.ai_phone_front_desk_profiles from public;
revoke all on table public.ai_phone_front_desk_profiles from anon;
revoke all on table public.ai_phone_front_desk_profiles from authenticated;
revoke all on table public.ai_phone_front_desk_calls from public;
revoke all on table public.ai_phone_front_desk_calls from anon;
revoke all on table public.ai_phone_front_desk_calls from authenticated;
