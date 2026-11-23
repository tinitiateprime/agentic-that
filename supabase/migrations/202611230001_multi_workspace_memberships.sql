-- One account can belong to several company workspaces (like Slack).
--
-- * workspace_memberships becomes one row per (user, workspace).
-- * Operational roles are scoped to the workspace they were granted in, so the
--   owner of one company is only an ordinary member of another.
-- * platform_users.workspace_id stays the account's currently selected
--   workspace; switching companies updates it.

lock table public.workspace_memberships, public.user_role_assignments in share row exclusive mode;

alter table public.workspace_memberships
  drop constraint if exists workspace_memberships_pkey;
alter table public.workspace_memberships
  add constraint workspace_memberships_pkey primary key (user_id, workspace_id);
create index if not exists idx_workspace_memberships_user
  on public.workspace_memberships (user_id);

alter table public.user_role_assignments
  add column if not exists workspace_id text
  references public.platform_workspaces(id) on delete cascade;

-- Before this migration every account had at most one membership, so each
-- existing role belongs to that workspace. Accounts without a membership
-- (platform administrators) keep account-wide roles (workspace_id null).
update public.user_role_assignments assignment
   set workspace_id = membership.workspace_id
  from public.workspace_memberships membership
 where membership.user_id = assignment.user_id
   and assignment.workspace_id is null;

alter table public.user_role_assignments
  drop constraint if exists user_role_assignments_pkey;
create unique index if not exists user_role_assignments_scope_key
  on public.user_role_assignments (user_id, role_id, (coalesce(workspace_id, '')));
create index if not exists idx_user_role_assignments_workspace
  on public.user_role_assignments (workspace_id, role_id);
