/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
const { useSession } = require('../lib/store/session-store.ts');
test('batch publishes once and rejects stale and foreign events', () => {
  useSession.setState({ sessionId: 'a', lastSeq: 0 });
  let updates = 0;
  const unsubscribe = useSession.subscribe(() => updates++);
  useSession.getState().applyEvents([
    { sessionId: 'a', seq: 1, type: 'status', state: 'running' },
    { sessionId: 'b', seq: 9, type: 'status', state: 'closed' },
    { sessionId: 'a', seq: 2, type: 'status', state: 'idle' },
    { sessionId: 'a', seq: 1, type: 'status', state: 'running' },
  ]);
  assert.equal(updates, 1);
  assert.equal(useSession.getState().status, 'idle');
  assert.equal(useSession.getState().lastSeq, 2);
  useSession.getState().applyEvents([]);
  assert.equal(updates, 1);
  unsubscribe();
});
test('batch matches individual event reduction', () => {
  const before = useSession.getState();
  const events = [
    { sessionId: 'a', seq: 3, type: 'status', state: 'running' },
    { sessionId: 'a', seq: 4, type: 'status', state: 'idle' },
  ];
  events.forEach((event) => useSession.getState().applyEvent(event));
  const expected = useSession.getState();
  useSession.setState(before, true);
  useSession.getState().applyEvents(events);
  assert.deepEqual(useSession.getState(), expected);
});

test('hydration uses current liveness instead of historical terminal events', () => {
  const meta = { id: 'resume', status: 'idle', live: true };
  useSession.getState().hydrate({ meta, events: [{ sessionId: 'resume', seq: 1, ts: 1000, type: 'status', state: 'closed' }], documents: [] });
  assert.equal(useSession.getState().meta.live, true);
  assert.equal(useSession.getState().connection, 'connecting');
  useSession.getState().hydrate({ meta: { ...meta, live: false }, events: [], documents: [] });
  assert.equal(useSession.getState().connection, 'not_live');
});

test('resume metadata synchronizes status and new events update activity', () => {
  useSession.getState().setMeta({ live: true, status: 'starting' });
  assert.equal(useSession.getState().status, 'starting');
  useSession.getState().applyEvent({ sessionId: 'resume', seq: 2, ts: 2000, type: 'status', state: 'idle' });
  assert.equal(useSession.getState().meta.updatedAt, new Date(2000).toISOString());
});
