-- Restore accounts in workspaces with an active owner. Product access now
-- follows the workspace owner role, so old trial clocks no longer apply.
with owner_workspaces as (
  select distinct membership.workspace_id
    from public.workspace_memberships membership
    join public.user_role_assignments assignment
      on assignment.user_id = membership.user_id
     and assignment.role_id = 'role_workspace_owner'
    join public.platform_users owner_user on owner_user.id = membership.user_id
   where membership.status = 'active'
     and owner_user.status = 'active'
)
update public.platform_users account
   set billing_status = 'exempt',
       trial_starts_at = null,
       trial_ends_at = null
  from public.workspace_memberships member
  join owner_workspaces owner_workspace on owner_workspace.workspace_id = member.workspace_id
 where member.user_id = account.id
   and member.status = 'active'
   and account.status = 'active'
   and account.billing_status in ('trialing', 'payment_pending', 'past_due', 'canceled', 'expired');

-- Retire trial grants left by the old signup flow. Workspace access is now
-- resolved from the active owner role, so these grants should not appear live.
update public.user_role_entitlements entitlement
   set status = 'inactive', updated_at = now()
  from public.workspace_memberships member
 where entitlement.user_id = member.user_id
   and member.status = 'active'
   and entitlement.source = 'trial'
   and entitlement.status = 'active'
   and exists (
     select 1
       from public.workspace_memberships owner_membership
       join public.user_role_assignments owner_assignment
         on owner_assignment.user_id = owner_membership.user_id
        and owner_assignment.role_id = 'role_workspace_owner'
       join public.platform_users owner_user on owner_user.id = owner_membership.user_id
      where owner_membership.workspace_id = member.workspace_id
        and owner_membership.status = 'active'
        and owner_user.status = 'active'
   );
