-- Telegram state is stored as workspace-owned rows instead of one global Blob.
-- Secrets and message bodies remain application-encrypted before persistence.

create schema if not exists agentic_that;
revoke all on schema agentic_that from public;

create table if not exists agentic_that.telegram_users (
  id                    text primary key,
  workspace_id          text,
  platform_user_id      text,
  display_name          text not null,
  token_hash            text not null unique,
  configured_login      text not null default '',
  password_hash         text,
  created_at            timestamptz not null,
  record                jsonb not null
);
create unique index if not exists telegram_users_workspace_platform_idx
  on agentic_that.telegram_users(workspace_id, platform_user_id)
  where workspace_id is not null and platform_user_id is not null;
create unique index if not exists telegram_users_configured_login_idx
  on agentic_that.telegram_users(configured_login) where configured_login <> '';
create index if not exists telegram_users_token_hash_idx
  on agentic_that.telegram_users(token_hash);

create table if not exists agentic_that.telegram_browser_sessions (
  id          text primary key,
  owner_id    text not null references agentic_that.telegram_users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  created_at  timestamptz not null,
  record      jsonb not null
);
create index if not exists telegram_browser_sessions_owner_idx
  on agentic_that.telegram_browser_sessions(owner_id, expires_at desc);

create table if not exists agentic_that.telegram_accounts (
  id                text primary key,
  owner_id          text not null references agentic_that.telegram_users(id) on delete cascade,
  telegram_user_id  text not null,
  display_name      text not null,
  username          text not null default '',
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  record            jsonb not null,
  unique (telegram_user_id)
);
create index if not exists telegram_accounts_owner_idx
  on agentic_that.telegram_accounts(owner_id, updated_at desc);

create table if not exists agentic_that.telegram_login_challenges (
  id          text primary key,
  owner_id    text not null references agentic_that.telegram_users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null,
  record      jsonb not null
);

create table if not exists agentic_that.telegram_messages (
  id          text primary key,
  owner_id    text not null references agentic_that.telegram_users(id) on delete cascade,
  account_id  text not null references agentic_that.telegram_accounts(id) on delete cascade,
  direction   text not null check (direction in ('inbound', 'outbound')),
  created_at  timestamptz not null,
  record      jsonb not null
);
create index if not exists telegram_messages_owner_account_idx
  on agentic_that.telegram_messages(owner_id, account_id, created_at desc);

create table if not exists agentic_that.telegram_posts (
  id                text primary key,
  owner_id          text not null references agentic_that.telegram_users(id) on delete cascade,
  account_id        text not null references agentic_that.telegram_accounts(id) on delete cascade,
  status            text not null,
  scheduled_at      timestamptz,
  lease_owner       text,
  lease_expires_at  timestamptz,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  record            jsonb not null
);
create index if not exists telegram_posts_owner_idx
  on agentic_that.telegram_posts(owner_id, created_at desc);
create index if not exists telegram_posts_due_idx
  on agentic_that.telegram_posts(status, scheduled_at)
  where status in ('Scheduled', 'Sending');

create table if not exists agentic_that.telegram_contacts (
  id          text primary key,
  owner_id    text not null references agentic_that.telegram_users(id) on delete cascade,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  record      jsonb not null
);
create index if not exists telegram_contacts_owner_idx on agentic_that.telegram_contacts(owner_id);

create table if not exists agentic_that.telegram_groups (
  id          text primary key,
  owner_id    text not null references agentic_that.telegram_users(id) on delete cascade,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  record      jsonb not null
);
create index if not exists telegram_groups_owner_idx on agentic_that.telegram_groups(owner_id);

create table if not exists agentic_that.telegram_channels (
  id          text primary key,
  owner_id    text not null references agentic_that.telegram_users(id) on delete cascade,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  record      jsonb not null
);
create index if not exists telegram_channels_owner_idx on agentic_that.telegram_channels(owner_id);

create table if not exists agentic_that.telegram_profiles (
  owner_id    text not null references agentic_that.telegram_users(id) on delete cascade,
  account_id  text not null references agentic_that.telegram_accounts(id) on delete cascade,
  updated_at  timestamptz not null,
  record      jsonb not null,
  primary key (owner_id, account_id)
);

create table if not exists agentic_that.telegram_media_uploads (
  id            text primary key,
  owner_id      text not null references agentic_that.telegram_users(id) on delete cascade,
  account_id    text not null references agentic_that.telegram_accounts(id) on delete cascade,
  file_name     text not null,
  mime_type     text not null,
  byte_size     bigint not null check (byte_size > 0),
  upload_offset bigint not null default 0 check (upload_offset >= 0),
  content       bytea not null default ''::bytea,
  created_at    timestamptz not null,
  completed_at  timestamptz,
  constraint telegram_media_offset_check check (upload_offset <= byte_size)
);
create index if not exists telegram_media_uploads_owner_idx
  on agentic_that.telegram_media_uploads(owner_id, account_id, created_at desc);
