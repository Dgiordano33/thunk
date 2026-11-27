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

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function conversation() {
  return [
    { type: 'user_message', messageId: 'message', content: 'Inspect', kind: 'prompt', queued: true },
    { type: 'message_dequeued', messageId: 'message' },
    { type: 'turn_start', turnId: 'turn' },
    { type: 'thinking_delta', turnId: 'turn', text: 'Consider ' },
    { type: 'thinking_delta', turnId: 'turn', text: 'this' },
    { type: 'text_delta', turnId: 'turn', text: 'Before ' },
    { type: 'text_delta', turnId: 'turn', text: 'tool' },
    { type: 'tool_use', turnId: 'turn', toolUseId: 'tool', name: 'Read', input: { path: 'file' } },
    { type: 'permission_request', requestId: 'permission', toolUseId: 'tool', toolName: 'Read', input: {} },
    { type: 'permission_resolved', requestId: 'permission', decision: 'allow' },
    { type: 'tool_result', toolUseId: 'tool', content: 'Result', isError: false },
    { type: 'ask_question', requestId: 'question', toolUseId: 'orphan', questions: [] },
    { type: 'question_escalated', requestId: 'question', recommendation: 'Continue', reason: 'Ready' },
    { type: 'question_resolved', requestId: 'question', answers: { choice: 'Yes' }, by: 'chief' },
    { type: 'plan_proposed', requestId: 'plan-request', toolUseId: 'plan-tool', documentId: 'plan', plan: 'Plan', version: 1 },
    { type: 'plan_resolved', requestId: 'plan-request', decision: 'approve' },
    { type: 'text_delta', turnId: 'turn', text: 'Response' },
    { type: 'turn_complete', turnId: 'turn', documentId: 'doc', markdown: 'Response', version: 1 },
    { type: 'result', costUsd: 0.25, numTurns: 1 },
    { type: 'user_message', messageId: 'revision', content: 'Revise', kind: 'revision', documentId: 'doc' },
    { type: 'error', message: 'Example error' },
    { type: 'board_op' },
    { type: 'status', state: 'idle', resumed: true },
  ].map((event, i) => ({ ...event, sessionId: 'history', seq: i + 1, ts: 1000 + i }));
}

test('mixed history replay agrees across batch boundaries and never mutates published snapshots', () => {
  const meta = { id: 'history', status: 'idle', live: true };
  const events = freeze(conversation());
  useSession.getState().hydrate({ meta, events: [], documents: [] });
  const initial = freeze(useSession.getState());
  for (const event of events) {
    const previous = useSession.getState();
    const json = JSON.stringify(previous);
    freeze(previous);
    previous.applyEvent(event);
    assert.equal(JSON.stringify(previous), json);
  }
  const expected = useSession.getState();
  for (const size of [2, 5, events.length]) {
    useSession.setState(initial, true);
    for (let i = 0; i < events.length; i += size) {
      const previous = useSession.getState();
      const json = JSON.stringify(previous);
      freeze(previous);
      previous.applyEvents(events.slice(i, i + size));
      assert.equal(JSON.stringify(previous), json);
    }
    assert.deepEqual(useSession.getState(), expected);
  }
  assert.equal(expected.documents.plan.status, 'approved');
  assert.equal(expected.documents.doc.status, 'sent');
  assert.equal(expected.tools.tool.approval, 'allow');
  assert.equal(expected.turns.turn.parts[0].text, 'Before tool');
  assert.equal(expected.turns.turn.parts[2].text, 'Response');
  assert.equal(expected.requests.question.by, 'chief');
  assert.equal(expected.items[0].queued, false);
  assert.equal(expected.costUsd, 0.25);
});

test('a stream batch preserves unrelated entries and rejects stale events without publishing', () => {
  useSession.getState().hydrate({ meta: { id: 'history', status: 'idle', live: true }, events: conversation(), documents: [] });
  const previous = freeze(useSession.getState());
  previous.applyEvents([
    { sessionId: 'history', seq: 24, ts: 2000, type: 'turn_start', turnId: 'next' },
    ...Array.from({ length: 1000 }, (_, i) => ({ sessionId: 'history', seq: 25 + i, ts: 2001 + i, type: 'text_delta', turnId: 'next', text: 'x' })),
    { sessionId: 'elsewhere', seq: 99999, type: 'status', state: 'closed' },
  ]);
  const next = useSession.getState();
  assert.equal(next.turns.turn, previous.turns.turn);
  assert.equal(next.tools, previous.tools);
  assert.equal(next.documents, previous.documents);
  assert.equal(next.requests, previous.requests);
  assert.equal(next.turns.next.parts[0].text.length, 1000);
  assert.equal(next.lastSeq, 1024);
  assert.equal(previous.turns.next, undefined);
  next.applyEvents([{ sessionId: 'history', seq: 1024, type: 'error', message: 'duplicate' }]);
  assert.equal(useSession.getState(), next);
});

test('hydration retains edited documents and linkage while rejecting foreign and duplicate events', () => {
  const events = conversation();
  const doc = freeze({ id: 'doc', kind: 'response', version: 1, currentMarkdown: 'User edit', baselineMarkdown: 'Response', contentJson: { type: 'doc', content: [] }, status: 'draft', comments: [{ id: 'comment', body: 'Keep this', replies: [] }] });
  useSession.getState().hydrate({
    meta: { id: 'history', status: 'closed', live: false },
    events: [events[0], { ...events[0], sessionId: 'foreign', seq: 9999 }, ...events], documents: [doc],
  });
  const state = useSession.getState();
  assert.equal(state.lastSeq, events.length);
  assert.equal(state.items.filter(item => item.id === 'message').length, 1);
  assert.equal(state.documents.doc.currentMarkdown, 'User edit');
  assert.equal(state.documents.doc.turnId, 'turn');
  assert.equal(state.documents.doc.comments, doc.comments);
  assert.equal(state.documents.doc.contentJson, doc.contentJson);
  assert.equal(state.meta.live, false);
  state.hydrate({ meta: { id: 'fresh', status: 'idle', live: true }, events: [], documents: [] });
  assert.deepEqual(useSession.getState().items, []);
  assert.deepEqual(useSession.getState().turns, {});
});
