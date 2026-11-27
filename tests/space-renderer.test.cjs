/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ reduced = false, entrance = false } = {}) {
  let now = 2000, id = 0;
  const frames = new Map(), timers = new Map(), document = { hidden: false,
    documentElement: { classList: { contains: () => false } }, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ exports: {}, document,
    window: { matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }) },
    MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    require: () => ({}), performance: { now: () => now },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/space/scene/renderer.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  // Exercise the real scheduler without depending on a GPU or shader compiler.
  context.exports.SpaceRenderer.prototype.setup = () => {};
  context.exports.SpaceRenderer.prototype.resize = () => {};
  const renderer = new context.exports.SpaceRenderer({ getContext: () => ({}), addEventListener() {}, removeEventListener() {} },
    { subscribe: () => () => {} }, {});
  const draws = [];
  Object.assign(renderer, { gl: { isContextLost: () => false }, raf: 0, timer: null, last: 0, activeUntil: 0,
    reduced, hover: new Map(), bobbed: new Map(), bodyData: null, bodies: [], t0: entrance ? now : 0,
    ready: true, disposed: false, unsub: [], store: { data: { bodies: [] }, hover: null, floaters: new Map() },
    draw: time => draws.push(time) });
  return { renderer, draws, frames, timers, document,
    step(ms = 1000 / 60, timestampLag = 0) {
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      const pending = [...frames]; frames.clear(); for (const [, fn] of pending) fn(now - timestampLag);
    },
  };
}

test('ambient rendering sleeps between draws and interactions wake it immediately', () => {
  const h = harness(); h.renderer.invalidate(); h.step();
  assert.equal(h.draws.length, 1); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 1);
  // A pan before the next ambient tick cancels the delay and draws at full rate.
  h.renderer.activeUntil = 3000; h.renderer.invalidate();
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 1);
  h.step(); assert.equal(h.draws.length, 2); assert.equal(h.frames.size, 1);
  h.renderer.stop(); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
});

test('ambient draws retain the 30fps cap and stop on hide or disposal', () => {
  const h = harness(); h.renderer.invalidate();
  for (let i = 0; i < 120; i++) h.step();
  assert.ok(h.draws.length >= 59 && h.draws.length <= 61, `draws: ${h.draws.length}`);
  h.document.hidden = true; h.renderer.stop(); h.renderer.invalidate();
  assert.equal(h.frames.size + h.timers.size, 0);
  h.document.hidden = false; h.renderer.invalidate(); h.step();
  assert.equal(h.timers.size, 1);
  h.renderer.dispose(); assert.equal(h.frames.size + h.timers.size, 0);
  h.renderer.invalidate(); assert.equal(h.frames.size, 0);
});

for (const hz of [60, 120, 144]) test(`idle cadence at ${hz}Hz tolerates delayed RAF timestamps without polling`, () => {
  const h = harness();
  let callbacks = 0;
  const tick = h.renderer.tick;
  h.renderer.tick = time => { callbacks++; tick(time); };
  h.renderer.invalidate();
  for (let i = 0; i < hz * 2; i++) {
    // Count tick calls separately from draws, as the browser benchmark does.
    h.step(1000 / hz, 1000 / hz);
  }
  assert.ok(h.draws.length >= 59 && h.draws.length <= 61);
  assert.ok(callbacks <= 61, `callbacks: ${callbacks}`);
});

test('reduced motion stops after its short fade and draws once per later invalidation', () => {
  const h = harness({ reduced: true, entrance: true }); h.renderer.invalidate();
  for (let i = 0; i < 60; i++) h.step();
  assert.ok(h.draws.length <= 10); assert.equal(h.frames.size + h.timers.size, 0);
  const count = h.draws.length;
  h.renderer.activeUntil = 4000; h.renderer.invalidate(); h.step();
  assert.equal(h.draws.length, count + 1); assert.equal(h.frames.size + h.timers.size, 0);
});

test('removing a hovered body does not leave a perpetual full-rate animation', () => {
  const h = harness();
  h.renderer.hover.set('removed', 0.5); h.renderer.bobbed.set('removed', 2); h.renderer.store.hover = 'removed';
  h.renderer.invalidate(); h.step();
  assert.equal(h.renderer.hover.size, 0); assert.equal(h.renderer.bobbed.size, 0);
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 1);
});
