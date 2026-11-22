// Decide which parts of a Mac's Claude Code and Codex setup make sense on this machine.
// Pure functions: nothing here touches the disk or the network (lib/setup/sync.ts does).

export type McpLike = { command?: string; url?: string; enabled?: boolean; [key: string]: unknown };
export type Dropped = { name: string; reason: string };

/** Settings that only drive tools on the sending Mac (Orca, status-line scripts). */
const MAC_ONLY_CLAUDE_SETTINGS = ["hooks", "statusLine"];

/** `~/.claude/settings.json` for this machine: everything except hooks and the status line. */
export function serverClaudeSettings(settings: Record<string, unknown> | null | undefined) {
  const copy = structuredClone(settings ?? {});
  const dropped = MAC_ONLY_CLAUDE_SETTINGS.filter((key) => key in copy);
  for (const key of dropped) delete copy[key];
  return { settings: copy, dropped };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const MAC_PATH = /(^|\/)(Applications|System|Library)\/|\.app(\/|$)|^\/opt\/homebrew\//;

/**
 * Whether an MCP server can run here. A bare command such as `npx` or `hs` is portable only if this machine has
 * it, so it comes back as `needs`.
 */
export function mcpPortability({ command, url, enabled }: McpLike): { portable: boolean; reason?: string; needs?: string } {
  if (enabled === false) return { portable: false, reason: "disabled" };
  if (url) {
    let host: string;
    try { host = new URL(url).hostname; } catch { return { portable: false, reason: "invalid URL" }; }
    return LOCAL_HOSTS.has(host) ? { portable: false, reason: "runs on the Mac's localhost" } : { portable: true };
  }
  if (!command) return { portable: false, reason: "no command or URL" };
  if (/^\.\.?\//.test(command)) return { portable: false, reason: "relative path" };
  if (MAC_PATH.test(command)) return { portable: false, reason: "macOS-only path" };
  return { portable: true, needs: command };
}

/** Keep the portable servers whose command this machine has. */
export function portableServers<T extends McpLike>(servers: Record<string, T> | null | undefined, has: (command: string) => boolean) {
  const kept: Record<string, T> = {};
  const dropped: Dropped[] = [];
  for (const [name, server] of Object.entries(servers ?? {})) {
    const p = mcpPortability(server);
    if (!p.portable) dropped.push({ name, reason: p.reason! });
    else if (p.needs && !has(p.needs)) dropped.push({ name, reason: `\`${p.needs}\` is not installed here` });
    else kept[name] = server;
  }
  return { kept, dropped };
}

/** Replace the sender's home directory in path strings (plugin install paths) with this machine's. */
export function rehome<T>(value: T, from: string, to: string): T {
  if (!from || from === to) return value;
  const escape = (s: string) => JSON.stringify(s).slice(1, -1);
  const pattern = new RegExp(escape(from).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + `(?=/|"|$)`, "g");
  const text = typeof value === "string" ? value.replace(pattern, to) : JSON.stringify(value).replace(pattern, escape(to));
  return (typeof value === "string" ? text : JSON.parse(text)) as T;
}

// ---- Codex config.toml ----
// A line-level TOML splitter, enough to keep or drop whole tables without rewriting their contents.

type ScanState = { depth: number; multi: string | null };

/** Track bracket depth and open multi-line strings for one line, ignoring brackets inside strings and comments. */
function scan(line: string, state: ScanState) {
  for (let i = 0; i < line.length; i++) {
    const rest = line.slice(i);
    if (state.multi) {
      if (rest.startsWith(state.multi)) { i += 2; state.multi = null; }
      continue;
    }
    if (rest.startsWith('"""') || rest.startsWith("'''")) { state.multi = rest.slice(0, 3); i += 2; continue; }
    const ch = line[i];
    if (ch === "#") break;
    if (ch === '"' || ch === "'") {
      for (i++; i < line.length && line[i] !== ch; i++) if (ch === '"' && line[i] === "\\") i++;
      continue;
    }
    if (ch === "[" || ch === "{") state.depth++;
    else if (ch === "]" || ch === "}") state.depth--;
  }
}

/** Split a dotted TOML key on dots outside quotes, unquoting each part. */
export function splitKey(key: string) {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of key.trim()) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ".") { parts.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

const HEADER = /^\s*(\[\[?)\s*(.+?)\s*\]\]?\s*(#.*)?$/;
type Statement = { key: string | null; lines: string[] };
type Block = { header: string | null; path: string[]; lines: string[]; statements: Statement[] };

/** Blocks of a TOML file: the top-level block (`path: []`), then one per `[table]` or `[[array]]` header. */
export function tomlBlocks(text: string): Block[] {
  const blocks: Block[] = [{ header: null, path: [], lines: [], statements: [] }];
  const state: ScanState = { depth: 0, multi: null };
  let statement: Statement | null = null;
  for (const line of text.split("\n")) {
    const atRoot = state.depth === 0 && !state.multi;
    const header = atRoot ? line.match(HEADER) : null;
    if (header) {
      blocks.push({ header: line, path: splitKey(header[2]), lines: [line], statements: [] });
      statement = null;
      continue;
    }
    const block = blocks[blocks.length - 1];
    block.lines.push(line);
    if (atRoot) {
      const key = line.match(/^\s*([A-Za-z0-9_."'-]+)\s*=/);
      statement = key ? { key: splitKey(key[1]).join("."), lines: [line] } : null;
      if (statement) block.statements.push(statement);
      else if (line.trim()) block.statements.push({ key: null, lines: [line] });
    } else if (statement) statement.lines.push(line);
    scan(line, state);
  }
  return blocks;
}

function value(lines: string[], key: string): string | boolean | undefined {
  for (const line of lines) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(true|false))`));
    if (m) return m[3] ? m[3] === "true" : (m[1] ?? m[2]);
  }
  return undefined;
}

/** The `[mcp_servers.<name>]` tables of a Codex config, with the fields that decide portability. */
export function codexMcpServers(text: string): Record<string, McpLike> {
  const servers: Record<string, McpLike> = {};
  for (const b of tomlBlocks(text)) {
    if (b.path[0] !== "mcp_servers" || b.path.length !== 2) continue;
    servers[b.path[1]] = { command: value(b.lines, "command") as string | undefined, url: value(b.lines, "url") as string | undefined, enabled: value(b.lines, "enabled") as boolean | undefined };
  }
  return servers;
}

/** Tables worth copying; the rest is desktop-app state, Mac plugins and hook trust for those plugins. */
const CODEX_TABLES = new Set(["features", "mcp_servers", "skills", "projects", "profiles", "model_providers"]);

/**
 * `~/.codex/config.toml` for this machine: model settings, features, profiles, trusted projects and the MCP
 * servers in `keepServers`. Drops `notify`, top-level values that point into macOS apps, and every other table.
 */
export function serverCodexConfig(text: string, keepServers: Set<string>) {
  const out: string[] = [];
  const dropped = new Set<string>();
  for (const b of tomlBlocks(text)) {
    if (!b.header) {
      for (const s of b.statements) {
        const mac = s.lines.some((l) => MAC_PATH.test(l));
        if (s.key && (s.key === "notify" || mac)) { dropped.add(s.key); continue; }
        out.push(...s.lines);
      }
      if (out.length) out.push("");
      continue;
    }
    const [table, name] = b.path;
    if (!CODEX_TABLES.has(table)) { dropped.add(table); continue; }
    if (table === "mcp_servers" && !keepServers.has(name)) continue;
    out.push(...b.lines);
  }
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", dropped: [...dropped] };
}
