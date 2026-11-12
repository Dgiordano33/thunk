/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { workspaceChanges } = require('../lib/projects/git.ts');
test('same-line-count edits change the diff signature', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thunk-changes-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const file = path.join(dir, 'note.txt');
  await fs.writeFile(file, 'one\n');
  const first = (await workspaceChanges(dir, null)).files[0];
  await fs.writeFile(file, 'two\n');
  await fs.utimes(file, new Date(), new Date(Date.now() + 1000));
  const second = (await workspaceChanges(dir, null)).files[0];
  assert.equal(first.additions, second.additions);
  assert.notEqual(first.mtimeMs, second.mtimeMs);
});
