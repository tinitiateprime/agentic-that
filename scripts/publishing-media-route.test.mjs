import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

async function fixture({ upload = null, submission = null, accounts = [], allowed = true } = {}) {
  const key = 'mediaRouteFixture_' + Math.random();
  globalThis[key] = { upload, submission, accounts, allowed, calls: [] };
  const source = await readFile('app/api/publishing/[...path]/route.js', 'utf8');
  const imports = [...source.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g)]
    .map(([, names, path]) => ({ names: names.replace(/[{}]/g, '').split(',').map(n => n.trim()).filter(Boolean), path }))
    .filter(({ path }) => path !== 'node:path');
  const modules = new Map(imports.map(({ names, path }) => [path, names]));
  const bundled = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'media-fixture', setup(b) {
    b.onResolve({ filter: /^@platform\/server\/publishing-media-response$/ }, () => ({ path: process.cwd() + '/src/platform/server/publishing-media-response.js' }));
    b.onResolve({ filter: /^(?:@platform\/|\.\.\/|\.\/supabase-job-control\.js|\.\/publishing-media-preview\.js)/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: `const f=globalThis[${JSON.stringify(key)}];\n` + (modules.get(a.path) || (a.path.endsWith('supabase-job-control.js') ? ['readSupabaseJobArtifactBytes','readSupabaseJobArtifactRange'] : a.path.endsWith('publishing-media-preview.js') ? ['optimizePublishingPreviewBytes'] : ['readPublishingMedia','readPublishingMediaRange'])).map(name => {
      const implementations = {
        authorizeApiCapability: "return {workspaceId:'workspace-a'};",
        principalHasAccess: 'return f.allowed;',
        accessErrorResponse: 'return Response.json({message:args[0].message},{status:403});',
        listCentralUploads: "f.calls.push(['uploads',args[0]]);return f.upload?[f.upload]:[];",
        listCentralSubmissions: "f.calls.push(['submissions',args[0]]);return f.submission?[f.submission]:[];",
        listCentralAccounts: 'return f.accounts;',
        publishingWorkspaceMediaRecord: "f.calls.push(['media',...args]);return f.upload||f.submission;",
        readSupabaseJobArtifactBytes: "f.calls.push(['artifact',args[0]]);return new Uint8Array([1,2,3]);",
        readSupabaseJobArtifactRange: "f.calls.push(['artifactRange',args[0],args[1],args[2]]);return new Uint8Array(args[2]-args[1]+1);",
        readPublishingMedia: "f.calls.push(['legacy',...args]);return new Uint8Array([4,5]);",
      };
      return `export async function ${name}(...args){${implementations[name] || `throw new Error('Unexpected ${name}');`}}`;
    }).join('\n') }));
  } }] });
  // The platform access predicate is synchronous in the actual route.
  const code = bundled.outputFiles[0].text.replace('async function principalHasAccess', 'function principalHasAccess');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  return { get: (file, headers = {}) => mod.GET(new Request('https://example.com/api/publishing/media/' + file, { headers }), { params: Promise.resolve({ path: ['media', file] }) }), state: globalThis[key], dispose: () => delete globalThis[key] };
}

test('private multipart publishing media reads its manifest instead of an absent flat object', async () => {
  const artifact = { kind: 'supabase_storage', parts: [{ objectPath: 'private/part-0' }] };
  const f = await fixture({ upload: { fileName: 'media.png', platform: 'instagram', mimeType: 'image/png', artifact } });
  try {
    const response = await f.get('media.png');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
    assert.deepEqual(f.state.calls, [['media', 'workspace-a', 'media.png'], ['artifact', artifact]]);
  } finally { f.dispose(); }
});

test('private media is not read when its platform is forbidden', async () => {
  const f = await fixture({ upload: { fileName: 'media.png', platform: 'instagram', artifact: {} }, allowed: false });
  try { assert.equal((await f.get('media.png')).status, 403); assert.deepEqual(f.state.calls, [['media', 'workspace-a', 'media.png']]); }
  finally { f.dispose(); }
});

test('an absent workspace media record conceals the file and never reads storage', async () => {
  const f = await fixture();
  try { assert.equal((await f.get('elsewhere.png')).status, 404); assert.deepEqual(f.state.calls, [['media', 'workspace-a', 'elsewhere.png']]); }
  finally { f.dispose(); }
});

test('legacy media continues to use its workspace-scoped flat object', async () => {
  const f = await fixture({ upload: { fileName: 'legacy.png', platform: 'instagram', mimeType: 'image/png' } });
  try { assert.equal((await f.get('legacy.png')).status, 200); assert.deepEqual(f.state.calls, [['media', 'workspace-a', 'legacy.png'], ['legacy', 'legacy.png', 'workspace-a']]); }
  finally { f.dispose(); }
});

test('private videos return the requested bytes and HTTP range metadata', async () => {
  const artifact = { byteSize: 10, parts: [{ path: 'private/video-part-0' }] };
  const f = await fixture({ upload: { fileName: 'media.mp4', platform: 'instagram', mimeType: 'video/mp4', size: 10, artifact } });
  try {
    const response = await f.get('media.mp4', { range: 'bytes=2-4' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal(response.headers.get('content-length'), '3');
    assert.deepEqual(f.state.calls, [['media', 'workspace-a', 'media.mp4'], ['artifactRange', artifact, 2, 4]]);
  } finally { f.dispose(); }
});

test('an invalid media range returns 416 before storage is contacted', async () => {
  const f = await fixture({ upload: { fileName: 'media.mp4', platform: 'instagram', mimeType: 'video/mp4', size: 10, artifact: {} } });
  try {
    const response = await f.get('media.mp4', { range: 'bytes=20-' });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
    assert.deepEqual(f.state.calls, [['media', 'workspace-a', 'media.mp4']]);
  } finally { f.dispose(); }
});

test('a submission needs a visible selected account before its media is read', async () => {
  const f = await fixture({ submission: { fileName: 'media.png', selectedAccountIds: ['unavailable-account'], artifact: {} } });
  try { assert.equal((await f.get('media.png')).status, 403); assert.deepEqual(f.state.calls, [['media', 'workspace-a', 'media.png']]); }
  finally { f.dispose(); }
});
