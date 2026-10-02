// Read current permissions in one round trip. On Amplify the shared Supabase
// pool is deliberately small; repeated per-request permission queries used to
// hold up concurrent publishing requests until the hosting timeout.
export async function readPrincipalAccessState(sql, userId) {
  const [state] = await sql`
    WITH selected_user AS (
      SELECT u.id, u.name, u.email, u.business_name, u.status, u.is_global_admin,
             coalesce((to_jsonb(u)->>'mfa_enabled')::boolean, false) AS mfa_enabled,
             u.billing_status, u.trial_starts_at, u.trial_ends_at,
             m.workspace_id
        FROM platform_users u
        LEFT JOIN workspace_memberships m ON m.user_id = u.id AND m.status = 'active'
       WHERE u.id = ${String(userId)}
       LIMIT 1
    ), workspace_owner AS (
      SELECT owner.id, owner.billing_status, owner.trial_starts_at, owner.trial_ends_at
        FROM selected_user selected
        JOIN workspace_memberships membership ON membership.workspace_id = selected.workspace_id
        JOIN user_role_assignments assignment
          ON assignment.user_id = membership.user_id AND assignment.role_id = 'role_workspace_owner'
        JOIN platform_users owner ON owner.id = membership.user_id
       WHERE membership.status = 'active' AND owner.status = 'active'
       ORDER BY membership.approved_at NULLS LAST, membership.created_at
       LIMIT 1
    ), billing_candidate AS (
      SELECT membership.user_id AS id
        FROM selected_user selected
        JOIN workspace_memberships membership ON membership.workspace_id = selected.workspace_id
        JOIN platform_users candidate ON candidate.id = membership.user_id
        JOIN user_role_entitlements entitlement ON entitlement.user_id = membership.user_id
       WHERE membership.status = 'active' AND candidate.status = 'active'
       ORDER BY CASE entitlement.status WHEN 'active' THEN 0 ELSE 1 END,
                CASE entitlement.source WHEN 'payment' THEN 0 ELSE 1 END,
                entitlement.expires_at DESC NULLS FIRST, membership.created_at
       LIMIT 1
    )
    SELECT to_jsonb(selected) AS "user",
           (SELECT to_jsonb(owner) FROM workspace_owner owner) AS "workspaceOwner",
           coalesce((SELECT id FROM billing_candidate), (SELECT id FROM workspace_owner), selected.id) AS "billingUserId",
           (SELECT jsonb_build_object('id', billing.id, 'billing_status', billing.billing_status,
                                     'trial_starts_at', billing.trial_starts_at, 'trial_ends_at', billing.trial_ends_at)
              FROM platform_users billing
             WHERE billing.id = coalesce((SELECT id FROM billing_candidate), (SELECT id FROM workspace_owner), selected.id)
           ) AS "workspaceBillingUser",
           coalesce((
             SELECT jsonb_agg(jsonb_build_object('role_id', entitlement.role_id,
                                               'resource_key', role_grant.resource_key, 'access_level', role_grant.access_level))
               FROM workspace_memberships membership
               JOIN user_role_entitlements entitlement ON entitlement.user_id = membership.user_id
               JOIN rbac_role_grants role_grant ON role_grant.role_id = entitlement.role_id
              WHERE membership.workspace_id = selected.workspace_id AND membership.status = 'active'
                AND entitlement.status = 'active' AND entitlement.starts_at <= now()
                AND (entitlement.expires_at IS NULL OR entitlement.expires_at > now())
           ), '[]'::jsonb) AS "workspaceModuleRoleGrants",
           coalesce((
             SELECT jsonb_agg(jsonb_build_object('role_id', entitlement.role_id,
                                               'resource_key', role_grant.resource_key, 'access_level', role_grant.access_level))
               FROM user_role_entitlements entitlement
               JOIN rbac_role_grants role_grant ON role_grant.role_id = entitlement.role_id
              WHERE entitlement.user_id = selected.id AND entitlement.status = 'active'
                AND entitlement.starts_at <= now()
                AND (entitlement.expires_at IS NULL OR entitlement.expires_at > now())
           ), '[]'::jsonb) AS "userModuleRoleGrants",
           coalesce((
             SELECT jsonb_agg(jsonb_build_object('role_id', assignment.role_id,
                                               'resource_key', role_grant.resource_key, 'access_level', role_grant.access_level))
               FROM user_role_assignments assignment
               JOIN rbac_role_grants role_grant ON role_grant.role_id = assignment.role_id
              WHERE assignment.user_id = selected.id
           ), '[]'::jsonb) AS "operationalRoleGrants"
      FROM selected_user selected
  `;
  return state || null;
}
