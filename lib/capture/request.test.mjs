import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayIdFor } from './request.ts';
const chief = { kind: 'chief' };
test('request identity follows dequeued messages, not the most recently submitted reply', () => {
  const events = [
    { seq: 1, type: 'user_message', messageId: 'a', content: '<relay id="A">Request A</relay>', queued: false },
    { seq: 2, type: 'user_message', messageId: 'b', content: '<relay id="B">Request B</relay>', queued: true },
    { seq: 3, type: 'message_dequeued', messageId: 'b' },
  ];
  assert.equal(relayIdFor(chief, events, 2), 'A');
  assert.equal(relayIdFor(chief, events), 'B');
  assert.equal(relayIdFor({ kind: 'worker', relayId: 'A' }, events), 'A');
});
test('mixed report batches are not assigned to an arbitrary request', () => {
  assert.equal(relayIdFor(chief, [{ seq: 1, type: 'user_message', content: '<worker_report task="t1" relay="A">Done</worker_report>\n<worker_report task="t2" relay="B">Done</worker_report>' }]), null);
  assert.equal(relayIdFor(chief, [{ seq: 1, type: 'user_message', content: '<relay_resume id="A">Continue</relay_resume>' }]), 'A');
});
