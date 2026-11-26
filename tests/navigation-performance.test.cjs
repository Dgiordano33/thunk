/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');

function load(file, mocks) {
  const filename = path.resolve(__dirname, '..', file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}

test('workspace route does not start Git work or serialize a pending Git promise', { timeout: 1000 }, async () => {
  let gitCalls = 0;
  const { default: Layout } = load('app/(shell)/[project]/[workspace]/layout.tsx', {
    'next/navigation': { notFound() { throw Error('not found'); } },
    '@/components/workspace/workspace-shell': { WorkspaceShell: 'shell' },
    '@/components/workspace/workspace-tabs': { WorkspaceTabs: 'tabs' },
    '@/lib/agent': { listSessions: async () => [{ id: 'session' }] },
    '@/lib/projects': { getWorkspaceContextBySlugs: async () => ({ project: { id: 'project' }, workspace: { id: 'workspace', cwd: '/repo', branch: 'main', repos: [{ cwd: '/repo' }] } }) },
    '@/lib/routes': { workspacePath: () => '/project/workspace' },
    '@/lib/projects/repo-targets': { workspaceRepoTargets: () => [{}] },
    '@/lib/projects/git': { worktreeStatus: () => { gitCalls++; throw Error("Git must not run during navigation"); } },
  });
  const result = await Layout({ params: Promise.resolve({ project: 'project', workspace: 'workspace' }), children: 'Conversation' });
  assert.equal(result.props.children, 'Conversation');
  assert.equal(result.props.sessions[0].id, 'session');
  assert.equal(gitCalls, 0);
  assert.equal(result.props.tabs.props.gitStatus, undefined);
});

for (const switching of [false, true]) test(`stream cleanup ${switching ? 'discards events after switching sessions' : 'flushes events for the same session'}`, () => {
  const effects = [];
  const applied = [];
  const connections = [];
  let stream;
  const state = { sessionId: 'first', meta: { live: true }, applyEvents: events => applied.push(...events), setConnection: c => connections.push(c), setMeta: () => {} };
  const useSession = selector => selector(state);
  useSession.getState = () => state;
  const noop = () => null;
  const mocks = {
    react: { ...React, useCallback: fn => fn, useEffect: fn => effects.push(fn), useLayoutEffect: noop, useRef: value => ({ current: value }), useState: value => [value, noop] },
    '@/lib/store/session-store': { useSession },
    '@/lib/store/ui-store': { useUi: { getState: () => ({ setCommentsOpen: noop }) } },
    '@/lib/client/api': { api: {} },
    '@/lib/client/sse': { connectSession: (_id, options) => { stream = options; return { close: noop }; } },
    '@/lib/client/use-document-persistence': { useDocumentPersistence: noop },
  };
  for (const [file, name] of [['@/components/chat/prompt-box', 'PromptBox'], ['@/components/chat/timeline', 'Timeline'], ['./pending-bar', 'PendingBar'], ['./session-header', 'SessionHeader']]) mocks[file] = { [name]: noop };
  const { SessionView } = load('components/session/session-view.tsx', mocks);
  const oldFrame = global.requestAnimationFrame;
  const oldCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = () => 1;
  global.cancelAnimationFrame = noop;
  try {
    SessionView({ meta: { id: 'first' }, events: [], documents: [] });
    const cleanup = effects[0]();
    const event = { type: 'test-event' };
    stream.onEvent(event);
    if (switching) state.sessionId = 'second';
    stream.onState("not_live");
    assert.deepEqual(connections, switching ? [] : ["not_live"]);
    cleanup();
    assert.deepEqual(applied, switching ? [] : [event]);
  } finally {
    global.requestAnimationFrame = oldFrame;
    global.cancelAnimationFrame = oldCancel;
  }
});

test('notebook metadata survives remount, refreshes in the background, and stays scoped', async () => {
  const effects = [];
  let response = { notes: [{ id: 'old' }], dir: '/notes' };
  let requests = 0;
  const { useScopeNotes } = load('lib/store/notes-store.ts', {
    react: { useCallback: fn => fn, useEffect: fn => effects.push(fn), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    zustand: { create: init => {
      const state = init(() => {});
      const useStore = selector => selector(state);
      useStore.getState = () => state;
      return useStore;
    } },
    '@/lib/client/api': { api: { listNotes: async () => { requests++; return response; } } },
    '@/lib/notes/types': { scopeKey: scope => `${scope.kind}:${scope.id}` },
  });
  const scope = { kind: 'projects', id: 'one' };
  assert.equal(useScopeNotes(scope).notes, null);
  // First effect opens the feed; second refreshes the metadata.
  effects[1]();
  await new Promise(setImmediate);
  effects.length = 0;
  assert.deepEqual(useScopeNotes(scope).notes, [{ id: 'old' }]);
  response = { notes: [{ id: 'new' }], dir: '/notes' };
  effects[1]();
  await new Promise(setImmediate);
  assert.deepEqual(useScopeNotes(scope).notes, [{ id: 'new' }]);
  assert.equal(requests, 2);
  assert.equal(useScopeNotes({ kind: 'projects', id: 'two' }).notes, null);
});
