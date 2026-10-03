-- Global-admin invitation email studio. Templates are structured and rendered
-- server-side; delivery rows retain template/version provenance without storing
-- reusable invitation tokens.

create table if not exists public.notification_templates (
  id          text primary key,
  purpose     text not null check (purpose in ('workspace_invitation')),
  channel     text not null check (channel in ('email')),
  name        text not null,
  description text not null default '',
  subject     text not null,
  content     jsonb not null default '{}'::jsonb,
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version     integer not null default 1 check (version > 0),
  created_by  text references public.platform_users(id) on delete set null,
  updated_by  text references public.platform_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists notification_templates_active_name_idx
  on public.notification_templates (purpose, channel, lower(name))
  where status <> 'archived';

create index if not exists notification_templates_lookup_idx
  on public.notification_templates (purpose, channel, status, updated_at desc);

create table if not exists public.notification_deliveries (
  id                  text primary key,
  invitation_id       text not null,
  template_id         text references public.notification_templates(id) on delete set null,
  template_version    integer not null,
  template_snapshot   jsonb not null,
  recipient_name      text not null default '',
  recipient_email     text not null,
  workspace_id        text references public.platform_workspaces(id) on delete set null,
  role_ids             jsonb not null default '[]'::jsonb,
  channel              text not null check (channel in ('email')),
  provider             text,
  provider_message_id  text,
  subject_snapshot     text not null,
  status               text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempt_count        integer not null default 0 check (attempt_count >= 0),
  error                text,
  created_by           text references public.platform_users(id) on delete set null,
  queued_at            timestamptz not null default now(),
  last_attempt_at      timestamptz,
  sent_at              timestamptz,
  updated_at           timestamptz not null default now()
);

create index if not exists notification_deliveries_recent_idx
  on public.notification_deliveries (queued_at desc);

create index if not exists notification_deliveries_invitation_idx
  on public.notification_deliveries (invitation_id, queued_at desc);

alter table public.notification_templates enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on table public.notification_templates from public;
revoke all on table public.notification_templates from anon;
revoke all on table public.notification_templates from authenticated;
revoke all on table public.notification_deliveries from public;
revoke all on table public.notification_deliveries from anon;
revoke all on table public.notification_deliveries from authenticated;
