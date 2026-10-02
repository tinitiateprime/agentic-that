import test from 'node:test';
import assert from 'node:assert/strict';
import { inFlightSnapshotReader } from './in-flight-snapshot.js';

test('simultaneous reads share work but isolate workspaces and mutable results', async () => {
  let calls = 0;
  const reader = inFlightSnapshotReader(async key => {
    calls++;
    await new Promise(resolve => setImmediate(resolve));
    return { key, nested: { state: 'queued' } };
  });
  const [a,b,c] = await Promise.all([reader.read('a'),reader.read('a'),reader.read('b')]);
  assert.equal(calls, 2);
  a.nested.state = 'posted';
  assert.equal(b.nested.state, 'queued');
  assert.equal(c.key, 'b');
  await reader.read('a');
  assert.equal(calls, 3);
});

test('a rejected read is retried without retaining a failed promise', async () => {
  let calls=0;
  const reader=inFlightSnapshotReader(async () => { if (++calls === 1) throw new Error('offline'); return calls; });
  const failed=await Promise.allSettled([reader.read('a'),reader.read('a')]);
  assert.ok(failed.every(result => result.status === 'rejected'));
  assert.equal(await reader.read('a'),2);
});

test('mutation invalidation starts a fresh read even while an older read finishes', async () => {
  const resolve=[];
  const reader=inFlightSnapshotReader(() => new Promise(done => resolve.push(done)));
  const first=reader.read('a');
  await new Promise(done => setImmediate(done));
  reader.invalidate('a');
  const second=reader.read('a');
  await new Promise(done => setImmediate(done));
  resolve[0]('old');
  assert.equal(await first,'old');
  const third=reader.read('a');
  resolve[1]('new');
  assert.deepEqual(await Promise.all([second,third]),['new','new']);
});
