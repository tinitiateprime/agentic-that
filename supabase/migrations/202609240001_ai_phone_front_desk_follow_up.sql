-- Email delivery and Google Calendar booking settings for each workspace.
alter table public.ai_phone_front_desk_profiles
  add column if not exists calendar_id text not null default '',
  add column if not exists time_zone text not null default 'UTC',
  add column if not exists appointment_duration_minutes integer not null default 60;

alter table public.ai_phone_front_desk_calls
  add column if not exists conversation_id text,
  add column if not exists email_status text not null default 'pending',
  add column if not exists email_error text,
  add column if not exists email_provider_id text,
  add column if not exists email_attempted_at timestamptz;

create unique index if not exists ai_phone_front_desk_calls_conversation_idx
  on public.ai_phone_front_desk_calls (workspace_id, conversation_id)
  where conversation_id is not null;

create table if not exists public.ai_phone_front_desk_alerts (
  id text primary key,
  workspace_id text not null references public.platform_workspaces(id) on delete cascade,
  conversation_id text not null,
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed')),
  caller_name text not null default '',
  caller_phone text not null default '',
  reason text not null default '',
  email_provider_id text,
  error text,
  updated_at timestamptz not null default now(),
  unique (workspace_id, conversation_id)
);

alter table public.ai_phone_front_desk_alerts enable row level security;
revoke all on public.ai_phone_front_desk_alerts from public, anon, authenticated;
