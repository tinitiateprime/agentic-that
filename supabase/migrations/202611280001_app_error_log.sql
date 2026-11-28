-- One table for errors from across the application, so failures in
-- production can be read without access to the hosting logs.
--
-- Written by lib/error-log.js from:
--   * Next.js onRequestError (instrumentation.js): API routes, page/server
--     component rendering, server actions and middleware;
--   * the browser, via POST /api/error-log/client (error boundaries);
--   * the Telegram service's request handler.
-- Read through GET /api/error-log: Super Admins see every row, everyone else
-- only the errors from their own requests.
--
-- Messages and stacks are truncated and scrubbed of tokens and connection
-- strings before they are stored; request bodies, headers and query strings
-- are never stored. Rows older than 30 days are pruned by the writer.

create schema if not exists agentic_that;

create table if not exists agentic_that.app_error_log (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  source        text not null,          -- server | client | telegram
  kind          text,                   -- route | render | action | middleware | boundary | ...
  method        text,
  path          text,                   -- request path, query string removed
  route         text,                   -- route pattern, e.g. /api/messages/[id]/media
  error_name    text,
  message       text not null,
  stack         text,
  digest        text,                   -- Next.js error digest shown to the browser
  code          text,                   -- e.g. a Postgres SQLSTATE
  user_id       text,
  username      text,                   -- login email of the signed-in user
  workspace_id  text,
  environment   text,
  context       jsonb not null default '{}'::jsonb
);

create index if not exists app_error_log_occurred_idx on agentic_that.app_error_log (occurred_at desc);
create index if not exists app_error_log_user_idx on agentic_that.app_error_log (user_id, occurred_at desc);
create index if not exists app_error_log_digest_idx on agentic_that.app_error_log (digest) where digest is not null;

-- Server-side only; never reachable through the Supabase browser roles.
revoke all on table agentic_that.app_error_log from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table agentic_that.app_error_log from anon, authenticated';
    execute 'revoke all on sequence agentic_that.app_error_log_id_seq from anon, authenticated';
  end if;
end
$$;
