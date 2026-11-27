/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');

function fixture(t, active = false, supported = true) {
  const state = { activeDocumentId: active ? 'doc' : 'other', documents: { doc: { currentMarkdown: 'Saved edit' } } };
  const scrollRef = { current: {} };
  const ref = { current: {} };
  let mounted, effect, callback, options, disconnected = 0, updates = 0, frame, cancelled;
  const previousObserver = global.IntersectionObserver;
  global.IntersectionObserver = supported ? class {
    constructor(fn, opts) { callback = fn; options = opts; }
    observe(element) { assert.equal(element, ref.current); }
    disconnect() { disconnected++; }
  } : undefined;
  t.after(() => { global.IntersectionObserver = previousObserver; });
  t.mock.method(global, 'requestAnimationFrame', fn => { frame = fn; return 7; });
  t.mock.method(global, 'cancelAnimationFrame', id => { cancelled = id; });
  const useSession = selector => selector(state);
  useSession.getState = () => state;
  const mocks = {
    react: { ...React, useState: init => { mounted ??= init(); return [mounted, value => { mounted = value; updates++; }]; }, useRef: () => ref, useEffect: fn => { effect = fn; } },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'use-stick-to-bottom': { useStickToBottomContext: () => ({ scrollRef }) },
    '@/lib/store/session-store': { useSession },
    './document-editor': { DocumentEditor: 'editor' },
  };
  const compiled = ts.transpileModule(fs.readFileSync(require.resolve('../components/document/deferred-editor.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, exports);
  return { render: () => exports.DeferredDocumentEditor({ documentId: 'doc', editable: true }), effect: () => effect(), intersect: value => callback([{ isIntersecting: value }]), options: () => options, disconnected: () => disconnected, updates: () => updates, frame: () => frame(), cancelled: () => cancelled, state, scrollRef };
}

// Node has no browser globals; provide configurable properties for t.mock.method.
for (const name of ['IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) global[name] = () => {};

test('offscreen documents retain text and mount once near the actual conversation scroller', t => {
  const f = fixture(t);
  assert.equal(f.render().props.children.props.children, 'Saved edit');
  const cleanup = f.effect();
  assert.equal(f.options().root, f.scrollRef.current);
  f.intersect(false);
  assert.equal(f.updates(), 0);
  f.state.documents.doc.currentMarkdown = 'Newer edit';
  assert.equal(f.render().props.children.props.children, 'Newer edit');
  f.intersect(true);
  assert.equal(f.render().props.children.type, 'editor');
  assert.equal(f.render().props.children.props.documentId, 'doc');
  assert.equal(f.render().props.children.props.editable, true);
  f.intersect(false);
  assert.equal(f.render().props.children.type, 'editor');
  cleanup();
  const updates = f.updates();
  f.intersect(true);
  assert.equal(f.updates(), updates, 'late observers must not update an unmounted session');
  assert.ok(f.disconnected() >= 1);
});

test('the active response mounts immediately', t => {
  const active = fixture(t, true);
  assert.equal(active.render().props.children.type, 'editor');
  assert.equal(active.effect(), undefined);
});

test('focusing older history opens its editor', t => {
  const older = fixture(t);
  older.render().props.onFocusCapture();
  assert.equal(older.render().props.children.type, 'editor');
});

test('browsers without IntersectionObserver still mount editors and cancel delayed work on navigation', t => {
  const f = fixture(t, false, false);
  f.render();
  const cleanup = f.effect();
  f.frame();
  assert.equal(f.render().props.children.type, 'editor');
  cleanup();
  assert.equal(f.cancelled(), 7);
  const updates = f.updates();
  f.frame();
  assert.equal(f.updates(), updates);
});
