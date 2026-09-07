-- Account IDs are the durable identity shared by the website and Companion.
-- Handles are user-entered labels and can legitimately be reused after an
-- account is replaced, disabled, or recovered from an older Companion.
-- A unique handle index made the entire heartbeat transaction fail in that
-- situation, leaving verified local sessions stuck as reconnect-required.
drop index if exists public.social_accounts_workspace_platform_handle_nonempty_idx;

create index if not exists social_accounts_workspace_platform_handle_lookup_idx
  on public.social_accounts(workspace_id, platform, lower(handle))
  where nullif(trim(handle), '') is not null;
