-- Server-only persistence for scraper caches/jobs and Global Admin projects.
create schema if not exists agentic_that;
revoke all on schema agentic_that from public, anon, authenticated;
create table if not exists agentic_that.app_document_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table agentic_that.app_document_store enable row level security;
revoke all on table agentic_that.app_document_store from public, anon, authenticated;
