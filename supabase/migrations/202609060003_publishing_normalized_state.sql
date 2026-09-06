-- Replace the shared Publishing JSON document with independently addressable,
-- workspace-scoped rows while preserving the API's existing record shapes.

create schema if not exists agentic_that;
revoke all on schema agentic_that from public;

create table if not exists agentic_that.publishing_state_migrations (
  key        text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists agentic_that.publishing_accounts (
  id text primary key,
  workspace_id text not null,
  updated_at timestamptz not null default now(),
  record jsonb not null
);
create index if not exists publishing_accounts_workspace_idx
  on agentic_that.publishing_accounts(workspace_id, updated_at desc);

create table if not exists agentic_that.publishing_uploads (
  id text primary key,
  workspace_id text not null,
  updated_at timestamptz not null default now(),
  record jsonb not null
);
create index if not exists publishing_uploads_workspace_idx
  on agentic_that.publishing_uploads(workspace_id, updated_at desc);

create table if not exists agentic_that.publishing_submissions (
  id text primary key,
  workspace_id text not null,
  updated_at timestamptz not null default now(),
  record jsonb not null
);
create index if not exists publishing_submissions_workspace_idx
  on agentic_that.publishing_submissions(workspace_id, updated_at desc);

create table if not exists agentic_that.publishing_schedules (
  id text not null,
  workspace_id text not null,
  updated_at timestamptz not null default now(),
  record jsonb not null,
  primary key (workspace_id, id)
);
create index if not exists publishing_schedules_workspace_idx
  on agentic_that.publishing_schedules(workspace_id, updated_at desc);

create table if not exists agentic_that.publishing_activity_logs (
  id text primary key,
  workspace_id text not null,
  created_at timestamptz not null default now(),
  record jsonb not null
);
create index if not exists publishing_activity_logs_workspace_idx
  on agentic_that.publishing_activity_logs(workspace_id, created_at desc);

create table if not exists agentic_that.publishing_legacy_jobs (
  id text primary key,
  workspace_id text not null,
  updated_at timestamptz not null default now(),
  record jsonb not null
);
create index if not exists publishing_legacy_jobs_workspace_idx
  on agentic_that.publishing_legacy_jobs(workspace_id, updated_at desc);

create table if not exists agentic_that.publishing_legacy_companions (
  id text primary key,
  workspace_id text not null,
  token_hash text,
  updated_at timestamptz not null default now(),
  record jsonb not null
);
create index if not exists publishing_legacy_companions_workspace_idx
  on agentic_that.publishing_legacy_companions(workspace_id, updated_at desc);
create index if not exists publishing_legacy_companions_token_idx
  on agentic_that.publishing_legacy_companions(token_hash) where token_hash is not null;

create table if not exists agentic_that.publishing_pairing_challenges (
  id text primary key,
  workspace_id text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  record jsonb not null
);
create unique index if not exists publishing_pairing_challenges_code_idx
  on agentic_that.publishing_pairing_challenges(code_hash);

-- One-time idempotent import of the previous central document.
do $$
declare
  legacy jsonb;
begin
  if not exists (
    select 1 from agentic_that.publishing_state_migrations
    where key = 'central-document-v1-imported'
  ) then
    if to_regclass('agentic_that.app_document_store') is not null then
      execute $query$
        select value
          from agentic_that.app_document_store
         where key = 'platform.publishing-central.v1'
      $query$ into legacy;
    end if;

    if legacy is not null then
      insert into agentic_that.publishing_accounts(id, workspace_id, updated_at, record)
      select item->>'id', item->>'workspaceId', coalesce(nullif(item->>'updatedAt', '')::timestamptz, now()), item
        from jsonb_array_elements(coalesce(legacy->'accounts', '[]'::jsonb)) item
       where nullif(item->>'id', '') is not null and nullif(item->>'workspaceId', '') is not null
      on conflict (id) do nothing;

      insert into agentic_that.publishing_uploads(id, workspace_id, updated_at, record)
      select item->>'id', item->>'workspaceId', coalesce(nullif(item->>'updatedAt', '')::timestamptz, now()), item
        from jsonb_array_elements(coalesce(legacy->'uploads', '[]'::jsonb)) item
       where nullif(item->>'id', '') is not null and nullif(item->>'workspaceId', '') is not null
      on conflict (id) do nothing;

      insert into agentic_that.publishing_submissions(id, workspace_id, updated_at, record)
      select item->>'id', item->>'workspaceId', coalesce(nullif(item->>'updatedAt', '')::timestamptz, now()), item
        from jsonb_array_elements(coalesce(legacy->'submissions', '[]'::jsonb)) item
       where nullif(item->>'id', '') is not null and nullif(item->>'workspaceId', '') is not null
      on conflict (id) do nothing;

      insert into agentic_that.publishing_schedules(id, workspace_id, updated_at, record)
      select item->>'id', item->>'workspaceId', coalesce(nullif(item->>'updatedAt', '')::timestamptz, now()), item
        from jsonb_array_elements(coalesce(legacy->'schedules', '[]'::jsonb)) item
       where nullif(item->>'id', '') is not null and nullif(item->>'workspaceId', '') is not null
      on conflict (id) do nothing;

      insert into agentic_that.publishing_activity_logs(id, workspace_id, created_at, record)
      select item->>'id', item->>'workspaceId', coalesce(nullif(item->>'createdAt', '')::timestamptz, now()), item
        from jsonb_array_elements(coalesce(legacy->'activityLogs', '[]'::jsonb)) item
       where nullif(item->>'id', '') is not null and nullif(item->>'workspaceId', '') is not null
      on conflict (id) do nothing;

      insert into agentic_that.publishing_legacy_jobs(id, workspace_id, updated_at, record)
      select item->>'id', item->>'workspaceId', coalesce(nullif(item->>'updatedAt', '')::timestamptz, now()), item
        from jsonb_array_elements(coalesce(legacy->'jobs', '[]'::jsonb)) item
       where nullif(item->>'id', '') is not null and nullif(item->>'workspaceId', '') is not null
      on conflict (id) do nothing;

      insert into agentic_that.publishing_legacy_companions(id, workspace_id, token_hash, updated_at, record)
      select item->>'id', item->>'workspaceId', item->>'tokenHash',
             coalesce(nullif(item->>'updatedAt', '')::timestamptz, now()), item
        from jsonb_array_elements(coalesce(legacy->'companions', '[]'::jsonb)) item
       where nullif(item->>'id', '') is not null and nullif(item->>'workspaceId', '') is not null
      on conflict (id) do nothing;

      insert into agentic_that.publishing_pairing_challenges(id, workspace_id, code_hash, expires_at, record)
      select item->>'id', item->>'workspaceId', item->>'codeHash', nullif(item->>'expiresAt', '')::timestamptz, item
        from jsonb_array_elements(coalesce(legacy->'pairingChallenges', '[]'::jsonb)) item
       where nullif(item->>'id', '') is not null
         and nullif(item->>'workspaceId', '') is not null
         and nullif(item->>'codeHash', '') is not null
         and nullif(item->>'expiresAt', '') is not null
      on conflict (id) do nothing;
    end if;

    insert into agentic_that.publishing_state_migrations(key)
    values ('central-document-v1-imported') on conflict do nothing;
  end if;
end $$;
