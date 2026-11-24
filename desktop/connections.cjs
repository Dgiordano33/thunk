const { BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFileSync, writeFileSync, renameSync, existsSync, rmSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const exec = promisify(execFile);
const { gitVersion } = require('./prerequisites.cjs');

function readKey(file, storage = safeStorage) {
  if (!existsSync(file)) return undefined;
  return storage.decryptString(readFileSync(file));
}
function saveKey(file, key, storage = safeStorage) {
  if (!storage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable. Unlock your system keychain (on Linux, a keyring such as GNOME Keyring or KWallet) and try again.');
  writeFileSync(file + '.tmp', storage.encryptString(key), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
function connections({ app, env, configKey }) {
  let win, pending;
  const file = path.join(app.getPath('userData'), 'anthropic-key.enc');
  const page = pathToFileURL(path.join(__dirname, 'connections.html')).href;
  const commands = { codex: env.CODEX_BIN || 'codex', github: 'gh' };
  const run = (provider, args) => exec(commands[provider], args, { env, timeout: 10000 });
  const status = async () => {
    const result = { claude: existsSync(file) ? 'Key saved · restart after changes' : configKey ? 'Configured outside Connections' : 'Not connected' };
    const git = await gitVersion(env);
    result.git = git ? `Installed · ${git}` : 'Not installed';
    await Promise.all(['codex', 'github'].map(async provider => {
      try { await run(provider, provider === 'codex' ? ['login', 'status'] : ['auth', 'status', '--hostname', 'github.com']); result[provider] = 'Connected'; }
      catch (error) { result[provider] = error.code === 'ENOENT' ? 'Not installed · rebuild with bundled tools' : 'Not connected'; }
    }));
    return result;
  };
  ipcMain.handle('thunk:connections', async (event, action, value) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Not allowed');
    if (action === 'status') return status();
    if (action === 'open-login' && ['codex', 'github'].includes(value)) { await shell.openExternal(value === 'codex' ? 'https://auth.openai.com/codex/device' : 'https://github.com/login/device'); return 'Complete sign-in in your browser using the code below.'; }
    if (action === 'save-key') {
      if (typeof value !== 'string' || !/^sk-ant-[\w-]{10,500}$/.test(value.trim())) throw new Error('Enter an Anthropic API key.');
      const response = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': value.trim(), 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(response.status === 401 ? 'That key was not accepted.' : `Could not verify this key (HTTP ${response.status}). Try again.`);
      saveKey(file, value.trim());
      return 'Key saved securely. Quit and reopen Thunk to use it. Restarting stops active work.';
    }
    if (action === 'remove-key') { rmSync(file, { force: true }); return 'Saved key removed. Quit and reopen Thunk to apply. Any key in your external configuration still applies.'; }
    if (action === 'cancel') { pending?.kill(); return 'Sign-in cancelled.'; }
    if (action !== 'connect' || !Object.hasOwn(commands, value)) throw new Error('Unknown action');
    if (pending) throw new Error('Finish or cancel the current sign-in first.');
    const args = value === 'codex' ? ['login', '--device-auth'] : ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'];
    return new Promise((resolve, reject) => {
      const child = spawn(commands[value], args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      pending = child;
      let output = '';
      const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
      const data = chunk => {
        output = (output + chunk.toString()).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-6000);
        if (win && !win.isDestroyed()) win.webContents.send('thunk:connection-progress', output);
      };
      child.stdout.on('data', data); child.stderr.on('data', data);
      const cleanup = () => { clearTimeout(timer); if (pending === child) pending = null; };
      child.once('error', () => { cleanup(); reject(new Error('Could not start sign-in. Check that the bundled tools are installed.')); });
      child.once('exit', code => { cleanup(); code === 0 ? resolve('Connected. You can return to Thunk.') : reject(new Error('Sign-in did not finish. Retry, or check that device sign-in is enabled for your account.')); });
    });
  });
  app.on('before-quit', () => pending?.kill());
  return async () => {
    if (win) { win.show(); win.focus(); return; }
    win = new BrowserWindow({ title: 'Connections', width: 580, height: 760, backgroundColor: '#f7f3e9', webPreferences: { preload: path.join(__dirname, 'connections-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('closed', () => { pending?.kill(); win = null; });
    await win.loadURL(page);
  };
}
module.exports = { connections, readKey, saveKey };
