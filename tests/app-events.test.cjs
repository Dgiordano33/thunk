/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}, mocks = {}) {
  const context = vm.createContext({ exports: {}, console, queueMicrotask, TextEncoder, ReadableStream, Response,
    require: name => { if (!(name in mocks)) throw Error(`Unexpected import ${name}`); return mocks[name]; }, ...globals });
  vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}

function sources() {
  const instances = [];
  class EventSource {
    static OPEN = 1;
    static CLOSED = 2;
    constructor(url) { this.url = url; this.readyState = 0; this.closed = false; instances.push(this); }
    close() { this.closed = true; }
    open() { this.readyState = 1; this.onopen(); }
    emit(topic, event) { this.onmessage({ data: JSON.stringify({ topic, event }) }); }
  }
  return { EventSource, instances };
}

function port() {
  return { messages: [], closed: false, postMessage(message) { this.messages.push(message); },
    start() {}, close() { this.closed = true; }, send(data) { this.onmessage({ data }); } };
}

test('worker shares a connection, keeps ordered delivery, and survives its first tab closing', () => {
  const { EventSource, instances } = sources();
  const self = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/app-events-worker.js'), 'utf8'), { self, EventSource, setTimeout, clearTimeout });
  const first = port(), second = port();
  for (const p of [first, second]) { self.onconnect({ ports: [p] }); p.send('connect'); }
  second.send('connect'); // Repeated handshake must not duplicate a subscription.
  assert.equal(instances.length, 1);
  const stream = instances[0];
  assert.equal(stream.url, '/api/events');
  stream.open();
  stream.emit('tasks', { id: 1 }); stream.emit('notes', { id: 2 });
  assert.equal(first.messages.length, 3); assert.equal(second.messages.length, 3);
  assert.deepEqual(second.messages.map(m => m.type), ['open', 'event', 'event']);
  assert.equal(JSON.parse(second.messages[2].data).event.id, 2);
  first.send('close');
  assert.equal(stream.closed, false);
  stream.emit('captures', { id: 3 });
  assert.equal(first.messages.length, 3); assert.equal(second.messages.length, 4);
  const late = port(); self.onconnect({ ports: [late] }); late.send('connect');
  assert.equal(late.messages[0].type, 'open', 'late tabs must refresh their snapshot');
  stream.onerror(); stream.open();
  assert.deepEqual(late.messages.map(m => m.type), ['open', 'error', 'open']);
  second.send('close'); late.send('close');
  assert.equal(stream.closed, true);
  const next = port(); self.onconnect({ ports: [next] }); next.send('connect');
  assert.equal(instances.length, 2);
  next.send('close');
});

test('worker replaces a source the browser closed for good', () => {
  const { EventSource, instances } = sources();
  const self = {}, timers = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/app-events-worker.js'), 'utf8'), {
    self, EventSource, setTimeout: fn => { timers.push(fn); return fn; }, clearTimeout: fn => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); },
  });
  const tab = port(); self.onconnect({ ports: [tab] }); tab.send('connect');
  instances[0].open();
  instances[0].readyState = 2; instances[0].onerror();
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(instances.length, 2);
  instances[1].open();
  assert.deepEqual(tab.messages.map(m => m.type), ['open', 'error', 'open']);
  // A reloaded tab also revives a closed source instead of waiting on it.
  instances[1].readyState = 2; instances[1].onerror();
  const reloaded = port(); self.onconnect({ ports: [reloaded] }); reloaded.send('connect');
  assert.equal(instances.length, 3); assert.equal(timers.length, 0);
  tab.send('close'); reloaded.send('close');
  assert.equal(instances[2].closed, true);
});

for (const mode of ['unsupported', 'throws', 'async-error', 'shared']) test(`client lifecycle: ${mode}`, async () => {
  const { EventSource, instances } = sources();
  const workers = [];
  const events = new Map();
  const window = { addEventListener: (type, fn) => events.set(type, fn), removeEventListener: type => events.delete(type) };
  class SharedWorker {
    constructor(url, options) {
      if (mode === 'throws') throw Error('blocked');
      this.url = url; this.options = options; this.port = port(); workers.push(this);
    }
  }
  const { subscribeAppEvents } = load('lib/client/app-events.ts', { window, EventSource,
    ...(mode === 'unsupported' ? {} : { SharedWorker }) });
  const seen = [], opened = [], errors = [];
  const a = subscribeAppEvents('tasks', { onEvent: e => seen.push(e.id), onOpen: () => opened.push('tasks'), onError: () => errors.push('tasks') });
  const b = subscribeAppEvents('notes', { onEvent: e => seen.push(e.id), onOpen: () => opened.push('notes') });
  if (mode === 'async-error') workers[0].onerror();
  const shared = mode === 'shared';
  assert.equal(instances.length, shared ? 0 : 1);
  const open = () => shared ? workers.at(-1).port.send({ type: 'open' }) : instances.at(-1).open();
  const emit = (topic, event) => shared ? workers.at(-1).port.send({ type: 'event', data: JSON.stringify({ topic, event }) }) : instances.at(-1).emit(topic, event);
  open(); assert.deepEqual(opened, ['tasks', 'notes']);
  emit('tasks', { id: 1 }); emit('notifications', { id: 99 }); emit('notes', { id: 2 });
  assert.deepEqual(seen, [1, 2]);
  const late = subscribeAppEvents('captures', { onEvent() {}, onOpen: () => opened.push('captures') });
  await new Promise(setImmediate); assert.equal(opened.at(-1), 'captures');
  late();
  if (shared) workers.at(-1).port.send({ type: 'error' }); else instances.at(-1).onerror();
  assert.deepEqual(errors, ['tasks']); open(); assert.equal(opened.filter(x => x === 'tasks').length, 2);
  events.get('online')();
  assert.equal(opened.filter(x => x === 'tasks').length, 3, 'retry snapshots even if the worker stayed connected');
  const old = shared ? workers.at(-1).port : instances.at(-1);
  events.get('pagehide')();
  assert.equal(old.closed, true);
  if (shared) old.send({ type: 'event', data: JSON.stringify({ topic: 'tasks', event: { id: 999 } }) });
  else old.emit('tasks', { id: 999 });
  assert.deepEqual(seen, [1, 2], 'callbacks queued before disconnect must be ignored');
  events.get('pageshow')(); open();
  emit('tasks', { id: 3 }); assert.deepEqual(seen, [1, 2, 3]);
  a(); emit('tasks', { id: 4 }); assert.deepEqual(seen, [1, 2, 3]);
  const current = shared ? workers.at(-1).port : instances.at(-1);
  assert.equal(current.closed, false); b(); assert.equal(current.closed, true);
  assert.equal(events.size, 0);
});

test('multiplex route orders every topic and releases all subscriptions on abort/cancel', async () => {
  const callbacks = new Map(), timers = new Set();
  const subscribe = topic => callback => { callbacks.set(topic, callback); return () => callbacks.delete(topic); };
  const { GET } = load('app/api/events/route.ts', {
    setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn),
  }, {
    '@/lib/notes/watch': { subscribeNotes: subscribe('notes') },
    '@/lib/tasks/events': { subscribeTasks: subscribe('tasks') },
    '@/lib/notifications/events': { subscribeNotifications: subscribe('notifications') },
    '@/lib/capture/events': { subscribeCaptures: subscribe('captures') },
  });
  for (const how of ['abort', 'cancel', 'already-aborted']) {
    const abort = new AbortController(); if (how === 'already-aborted') abort.abort();
    const response = GET(new Request('http://localhost/api/events', { signal: abort.signal }));
    const reader = response.body.getReader();
    if (how === 'already-aborted') { assert.equal((await reader.read()).done, true); continue; }
    const decoder = new TextDecoder();
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(decoder.decode((await reader.read()).value), ':ok\n\n');
    assert.equal(callbacks.size, 4); assert.equal(timers.size, 1);
    for (const [topic, callback] of callbacks) {
      callback({ id: topic });
      assert.equal(decoder.decode((await reader.read()).value), `data: ${JSON.stringify({ topic, event: { id: topic } })}\n\n`);
    }
    if (how === 'abort') abort.abort(); else await reader.cancel();
    assert.equal((await reader.read()).done, true);
    assert.equal(callbacks.size, 0); assert.equal(timers.size, 0);
  }
});

test('notes reconnect invalidates every scope and open editor without inventing note changes', () => {
  let handlers, state;
  const { useNotesEvents } = load('lib/store/notes-store.ts', {}, {
    react: { useEffect: fn => fn() },
    zustand: { create: init => {
      const setState = update => { state = { ...state, ...update(state) }; };
      state = init(setState); return { getState: () => state, setState };
    } },
    '@/lib/client/api': {}, '@/lib/notes/types': { scopeKey: s => s.id },
    '@/lib/client/app-events': { subscribeAppEvents: (_topic, h) => { handlers = h; return () => {}; } },
  });
  useNotesEvents();
  handlers.onEvent({ scope: { id: 'one' }, noteId: 'n' });
  assert.equal(state.scopeRev.one, 1); assert.equal(state.noteRev['one/n'], 1);
  handlers.onOpen();
  assert.equal(state.resetRev, 0, 'the first open follows a fresh mount fetch');
  handlers.onOpen(); handlers.onOpen();
  assert.equal(state.rev, 3); assert.equal(state.resetRev, 2);
  assert.equal(state.scopeRev.one, 1); assert.equal(state.noteRev['one/n'], 1);
});
