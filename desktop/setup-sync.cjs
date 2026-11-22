// Send this Mac's Claude Code and Codex setup to a Thunk server over its own HTTPS address
// (POST /api/setup/sync, app/api/setup/sync/route.ts). Used by the Mac app and `npm run server:sync-config`.
// Only files that differ are sent. Sign-ins, history and sessions are never read.
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, realpathSync, statSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_FILE = 12 * 1024 * 1024;
const BATCH = 12 * 1024 * 1024; // raw bytes per request; base64 stays under the server's 30 MB body limit
const SKIP = new Set(['.git', '.DS_Store', 'node_modules']);

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const readText = file => { try { const t = readFileSync(file, 'utf8'); return t.trim() ? t : null; } catch { return null; } };
const inside = (dir, file) => file === dir || file.startsWith(dir + path.sep);

/** Every file under `dir`, following symlinks (skills are often links into repos), without loops. */
function walk(dir, { exclude = [] } = {}) {
  const out = [];
  const seen = new Set();
  const visit = (abs, rel) => {
    let real;
    try { real = realpathSync(abs); } catch { return; }
    if (seen.has(real)) return;
    let s;
    try { s = statSync(abs); } catch { return; }
    if (s.isDirectory()) {
      seen.add(real);
      for (const name of readdirSync(abs)) {
        if (SKIP.has(name) || (!rel && exclude.includes(name))) continue;
        visit(path.join(abs, name), rel ? `${rel}/${name}` : name);
      }
    } else if (s.isFile()) out.push({ abs, rel, size: s.size, executable: (s.mode & 0o111) !== 0 });
  };
  if (existsSync(dir)) visit(dir, '');
  return out;
}

/** What to send: the settings documents plus a list of files per root (see SYNC_ROOTS in lib/setup/sync.ts). */
function collectSetup(home = os.homedir()) {
  const claude = path.join(home, '.claude');
  const plugins = path.join(claude, 'plugins');
  const settings = readJson(path.join(claude, 'settings.json'));
  const enabled = Object.entries(settings?.enabledPlugins ?? {}).filter(([, on]) => on === true).map(([name]) => name);

  // Only enabled plugins, from their install folder in the cache, plus the marketplaces they come from.
  const installed = readJson(path.join(plugins, 'installed_plugins.json'));
  const known = readJson(path.join(plugins, 'known_marketplaces.json'));
  const installedPlugins = installed ? { ...installed, plugins: {} } : null;
  const files = [];
  const add = (root, base, list) => { for (const f of list) files.push({ root, ...f, rel: base ? `${base}/${f.rel}` : f.rel }); };
  const cache = path.join(plugins, 'cache');
  const marketplaces = new Set();
  for (const name of enabled) {
    const entries = installed?.plugins?.[name] ?? [];
    const entry = entries.find(e => e.scope === 'user') ?? entries[0];
    if (!entry?.installPath || !inside(cache, entry.installPath)) continue;
    installedPlugins.plugins[name] = [entry];
    add('claude-plugins-cache', path.relative(cache, entry.installPath), walk(entry.installPath));
    marketplaces.add(name.slice(name.lastIndexOf('@') + 1));
  }
  const marketDir = path.join(plugins, 'marketplaces');
  const knownMarketplaces = known ? Object.fromEntries(Object.entries(known).filter(([name]) => marketplaces.has(name))) : null;
  for (const m of Object.values(knownMarketplaces ?? {})) {
    if (m.installLocation && inside(marketDir, m.installLocation)) add('claude-plugins-marketplaces', path.relative(marketDir, m.installLocation), walk(m.installLocation));
  }

  const skillsDir = path.join(claude, 'skills');
  add('claude-skills', '', walk(skillsDir, { exclude: ['synced'] }));
  const codexSkillsDir = path.join(home, '.codex', 'skills');
  add('codex-skills', '', walk(codexSkillsDir, { exclude: ['.system'] }));
  const topDirs = (root) => [...new Set(files.filter(f => f.root === root && f.rel.includes('/')).map(f => f.rel.split('/')[0]))].sort();

  return {
    home,
    files,
    documents: {
      claudeSettings: settings,
      claudeMcpServers: readJson(path.join(home, '.claude.json'))?.mcpServers ?? {},
      installedPlugins,
      knownMarketplaces,
      codexConfig: readText(path.join(home, '.codex', 'config.toml')),
      codexAgents: readText(path.join(home, '.codex', 'AGENTS.md')),
    },
    skills: topDirs('claude-skills'),
    codexSkills: topDirs('codex-skills'),
  };
}

async function post(baseUrl, body, fetchImpl) {
  const response = await fetchImpl(new URL('/api/setup/sync', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `The server answered HTTP ${response.status}`);
  return data;
}

/**
 * Sync to the Thunk server at `baseUrl`. `onProgress(text)` gets short status lines. With `dryRun`, only asks the
 * server what differs. Resolves with the server's summary (lib/setup/sync.ts SyncSummary), or the plan for a dry run.
 */
async function syncSetup({ baseUrl, home = os.homedir(), onProgress = () => {}, dryRun = false, fetchImpl = fetch }) {
  onProgress('Reading your setup…');
  const setup = collectSetup(home);
  const skipped = [];
  const files = setup.files.filter(f => {
    if (f.size <= MAX_FILE) return true;
    skipped.push({ path: f.abs.replace(home, '~'), reason: 'larger than 12 MB' });
    return false;
  });
  const manifest = files.map(f => ({ root: f.root, path: f.rel, size: f.size, sha256: createHash('sha256').update(readFileSync(f.abs)).digest('hex') }));
  onProgress(`Comparing ${files.length} files with the server…`);
  const { need } = await post(baseUrl, { step: 'plan', manifest }, fetchImpl);
  const changed = need.map(i => files[i]);
  const bytes = changed.reduce((n, f) => n + f.size, 0);
  if (dryRun) return { total: files.length, changed: changed.length, bytes, skipped, documents: Object.keys(setup.documents).filter(k => setup.documents[k]) };

  let sent = 0;
  for (let i = 0; i < changed.length;) {
    const batch = [];
    let size = 0;
    while (i < changed.length && (batch.length === 0 || size + changed[i].size <= BATCH)) {
      const f = changed[i++];
      size += f.size;
      batch.push({ root: f.root, path: f.rel, data: readFileSync(f.abs).toString('base64'), executable: f.executable });
    }
    onProgress(`Uploading ${sent + 1}–${sent + batch.length} of ${changed.length} changed files…`);
    await post(baseUrl, { step: 'files', files: batch }, fetchImpl);
    sent += batch.length;
  }
  onProgress('Applying settings…');
  return post(baseUrl, {
    step: 'finish',
    from: { host: os.hostname().replace(/\.local$/, ''), home },
    ...setup.documents,
    counts: { files: files.length, uploaded: changed.length, skills: setup.skills, codexSkills: setup.codexSkills },
    skipped,
  }, fetchImpl);
}

/** One-paragraph result for a dialog or terminal. */
function describeSummary(s) {
  const list = items => (items.length ? items.join(', ') : 'none');
  const lines = [
    `${s.claude.skills.length} Claude skills, ${s.claude.plugins.length} plugins, ${s.codex.skills.length} Codex skills. ${s.files.uploaded} of ${s.files.total} files changed.`,
    `MCP servers: Claude ${list(s.claude.mcp.kept)}; Codex ${list(s.codex.mcp.kept)}.`,
  ];
  const dropped = [...s.claude.mcp.dropped.map(d => `Claude ${d.name} (${d.reason})`), ...s.codex.mcp.dropped.map(d => `Codex ${d.name} (${d.reason})`)];
  if (dropped.length) lines.push(`Skipped: ${dropped.join('; ')}.`);
  if (s.files.skipped.length) lines.push(`Files too large to send: ${s.files.skipped.map(f => f.path).join(', ')}.`);
  return lines.join('\n');
}

module.exports = { collectSetup, syncSetup, describeSummary, walk };
