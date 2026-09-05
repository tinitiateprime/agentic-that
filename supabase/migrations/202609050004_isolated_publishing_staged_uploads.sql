-- Keep large browser uploads independent from the shared publishing document so
-- media transfers cannot contend with dashboard, account, or Companion updates.
create table if not exists agentic_that.publishing_staged_uploads (
  id                 text primary key,
  workspace_id       text not null,
  created_by_user_id text,
  original_name      text not null,
  mime_type          text not null default '',
  byte_size          bigint not null check (byte_size > 0 and byte_size <= 2147483648),
  upload_offset      bigint not null default 0 check (upload_offset >= 0 and upload_offset <= byte_size),
  chunk_size         integer not null check (chunk_size > 0),
  upload_strategy    text not null default 'signed_parts' check (upload_strategy in ('signed_parts', 'server_chunks')),
  file_name          text not null,
  artifact_parts     jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists publishing_staged_uploads_workspace_updated_idx
  on agentic_that.publishing_staged_uploads(workspace_id, updated_at desc);

revoke all on table agentic_that.publishing_staged_uploads from public, anon, authenticated;
