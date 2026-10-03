import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function fixture(states, testing = false) {
  const key = 'principalFixture_' + Math.random();
  globalThis[key] = { states: structuredClone(states), reads: 0, refreshes: [] };
  const bundled = await build({ entryPoints: ['src/platform/server/access-control.js'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'authorization-fixture', setup(b) {
    b.onResolve({ filter: /^(next\/navigation|\.\/auth-store\.js|\.\/principal-access-store\.js|.*team-testing-access\.js)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'next/navigation' ? 'export function redirect(){ throw new Error("Unexpected redirect"); }'
      : a.path.endsWith('team-testing-access.js') ? `export function teamTestingFullAccessEnabled(){return ${testing};}`
      : a.path.endsWith('principal-access-store.js') ? `export async function readPrincipalAccessState(){const f=globalThis[${JSON.stringify(key)}];return f.states[Math.min(f.reads++,f.states.length-1)];}`
      : `export async function getPlatformSql(){return {};}
         export async function getCurrentPlatformUser(){return null;}
         export async function activateWorkspaceTrial(){return null;}
         export async function refreshPlatformBillingState(id){globalThis[${JSON.stringify(key)}].refreshes.push(id);}` }));
  } }] });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  return { mod, state: globalThis[key], dispose: () => delete globalThis[key] };
}

function state({ owner = false, active = true, grant = true } = {}) {
  return {
    user: { id: 'member', workspace_id: 'workspace-a', name: 'Member', status: active ? 'active' : 'disabled', is_global_admin: false },
    workspaceOwner: owner ? { id: 'workspace-owner', billing_status: 'active' } : null,
    billingUserId: 'entitlement-holder', workspaceBillingUser: { id: 'entitlement-holder', billing_status: 'active' },
    workspaceModuleRoleGrants: grant ? [{ role_id: 'plan', resource_key: 'publishing', access_level: 'configure' }] : [],
    userModuleRoleGrants: [],
    operationalRoleGrants: [{ role_id: 'viewer', resource_key: 'publishing.view', access_level: 'view' }],
  };
}

test('billing refresh removes expired module access before a principal is returned', async () => {
  process.env.DATABASE_URL = 'fixture';
  const f = await fixture([state(), state({ grant: false })]);
  try {
    const principal = await f.mod.getPrincipalForUser({ id: 'member' });
    assert.deepEqual(f.state.refreshes, ['entitlement-holder']);
    assert.equal(f.state.reads, 2);
    assert.equal(principal.access['publishing.instagram'], 'none');
    assert.deepEqual(principal.capabilities, []);
  } finally { f.dispose(); }
});

test('an owned workspace still restricts a viewer to their operational capabilities', async () => {
  process.env.DATABASE_URL = 'fixture';
  const f = await fixture([state({ owner: true })]);
  try {
    const principal = await f.mod.getPrincipalForUser({ id: 'member', mfaVerified: true });
    assert.equal(f.state.reads, 1);
    assert.deepEqual(f.state.refreshes, []);
    assert.deepEqual(principal.capabilities, ['publishing.view']);
    assert.equal(principal.access['publishing.instagram'], 'view');
    assert.equal(f.mod.principalHasCapability(principal, 'publishing.execute'), false);
    assert.equal(principal.mfaVerified, true);
  } finally { f.dispose(); }
});

test('disabled members receive no access even in an owned workspace', async () => {
  process.env.DATABASE_URL = 'fixture';
  const f = await fixture([state({ owner: true, active: false })]);
  try {
    const principal = await f.mod.getPrincipalForUser({ id: 'member' });
    assert.deepEqual(principal.capabilities, []);
    assert.equal(principal.access['publishing.instagram'], 'none');
  } finally { f.dispose(); }
});

test('a deleted user after billing refresh cannot retain the previous principal', async () => {
  process.env.DATABASE_URL = 'fixture';
  const f = await fixture([state(), null]);
  try { assert.equal(await f.mod.getPrincipalForUser({ id: 'member' }), null); }
  finally { f.dispose(); }
});
