const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { readKey, saveKey } = require('./connections.cjs');
const { releaseUrl } = require('./releases.cjs');
function fixture(t) { const dir = mkdtempSync(path.join(tmpdir(), 'thunk-connections-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'key'); }
test('credential storage uses encryption, private permissions and replacement', t => {
  const file = fixture(t);
  const storage = { isEncryptionAvailable: () => true, encryptString: key => Buffer.from(key.split('').reverse().join('')), decryptString: data => data.toString().split('').reverse().join('') };
  assert.equal(readKey(file, storage), undefined);
  saveKey(file, 'first-secret', storage);
  assert.notEqual(readFileSync(file, 'utf8'), 'first-secret');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  saveKey(file, 'new-secret', storage);
  assert.equal(readKey(file, storage), 'new-secret');
  assert.throws(() => saveKey(file, 'lost', { isEncryptionAvailable: () => false }), /Secure credential storage/);
  assert.equal(readKey(file, storage), 'new-secret');
});
test('release download links allow only GitHub repository names', t => {
  const file = fixture(t);
  assert.equal(releaseUrl(file), 'https://github.com/Dgiordano33/thunk/releases/latest');
  writeFileSync(file, 'THUNK_RELEASE_REPO=someone/downloads');
  assert.equal(releaseUrl(file), 'https://github.com/someone/downloads/releases/latest');
  for (const repo of ['https://evil.example', '../foo', 'a/b?x=1', 'a/b/c']) {
    writeFileSync(file, `THUNK_RELEASE_REPO=${repo}`);
    assert.throws(() => releaseUrl(file), /owner\/repository/);
  }
});
test('Connections IPC refuses other windows and unexpected actions', async t => {
  const vm = require('node:vm');
  let handler;
  let fakeWindow;
  class Window {
    constructor() { fakeWindow = this; this.webContents = { mainFrame: { url: '' }, setWindowOpenHandler() {}, on() {} }; }
    on() {}
    async loadURL(url) { this.webContents.mainFrame.url = url; }
  }
  const sandbox = { module: { exports: {} }, __dirname, require: name => name === 'electron' ? { BrowserWindow: Window, ipcMain: { handle: (_name, fn) => { handler = fn; } } } : require(name) };
  vm.runInNewContext(readFileSync(path.join(__dirname, 'connections.cjs'), 'utf8'), sandbox);
  const show = sandbox.module.exports.connections({ app: { getPath: () => path.dirname(fixture(t)), on() {} }, env: {}, configKey: false });
  await show();
  await assert.rejects(handler({ sender: {} }, 'save-key', 'secret'), /Not allowed/);
  const event = { sender: fakeWindow.webContents, senderFrame: fakeWindow.webContents.mainFrame };
  await assert.rejects(handler(event, 'execute', 'anything'), /Unknown action/);
  await assert.rejects(handler(event, 'save-key', 'not-a-key'), /Enter an Anthropic API key/);
  await assert.rejects(handler({ ...event, senderFrame: { url: event.senderFrame.url } }, 'status'), /Not allowed/);
});
