-- Global-admin AI Website Studio.
-- Generated content is stored as structured data and rendered by the shared
-- website engine. Preview access uses a high-entropy token whose digest alone
-- is persisted. Selecting a preview atomically publishes that design.

create table if not exists public.ai_website_projects (
  id                    text primary key,
  created_by            text references public.platform_users(id) on delete set null,
  business_name         text not null,
  business_type         text not null,
  client_name           text not null,
  client_email          text not null,
  business_profile      jsonb not null default '{}'::jsonb,
  site_spec             jsonb,
  qa_report             jsonb not null default '{}'::jsonb,
  status                text not null default 'generating'
                        check (status in ('generating', 'awaiting_selection', 'published', 'failed')),
  selected_theme        text check (selected_theme in ('editorial', 'momentum', 'aura')),
  public_slug           text not null unique,
  preview_token_hash    text not null unique,
  preview_expires_at    timestamptz not null default (now() + interval '30 days'),
  generation_model      text,
  generation_attempts   integer not null default 0 check (generation_attempts >= 0),
  prompt_tokens         integer,
  output_tokens         integer,
  email_status          text not null default 'pending'
                        check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  email_provider_id     text,
  email_error           text,
  failure_message       text,
  generated_at          timestamptz,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists ai_website_projects_recent_idx
  on public.ai_website_projects (created_at desc);

create index if not exists ai_website_projects_status_idx
  on public.ai_website_projects (status, updated_at desc);

create index if not exists ai_website_projects_client_idx
  on public.ai_website_projects (lower(client_email), created_at desc);

alter table public.ai_website_projects enable row level security;

revoke all on table public.ai_website_projects from public;
revoke all on table public.ai_website_projects from anon;
revoke all on table public.ai_website_projects from authenticated;
