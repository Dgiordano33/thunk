import "server-only";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import { sharedConfigDir } from "@/lib/projects/paths";
import { codexMcpServers, portableServers, rehome, serverClaudeSettings, serverCodexConfig, type Dropped } from "./portable";
import { readAgentSettings, updateAgentSettings } from "./settings";

/** Folders a sync may write into, relative to the home directory. Everything else is a single named file. */
export const SYNC_ROOTS = {
  "claude-skills": ".claude/skills",
  "claude-plugins-cache": ".claude/plugins/cache",
  "claude-plugins-marketplaces": ".claude/plugins/marketplaces",
  "codex-skills": ".codex/skills",
} as const;
export type SyncRoot = keyof typeof SYNC_ROOTS;
const rootKeys = Object.keys(SYNC_ROOTS) as [SyncRoot, ...SyncRoot[]];

const relPath = z.string().min(1).max(1024).refine((p) => {
  if (p.includes("\0") || p.includes("\\") || p.startsWith("/")) return false;
  const parts = p.split("/");
  return parts.every((s) => s !== "" && s !== "." && s !== "..");
}, "Invalid path");

export const PlanInput = z.object({
  step: z.literal("plan"),
  manifest: z.array(z.object({ root: z.enum(rootKeys), path: relPath, size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(50_000),
});
export const FilesInput = z.object({
  step: z.literal("files"),
  files: z.array(z.object({ root: z.enum(rootKeys), path: relPath, data: z.string(), executable: z.boolean().optional() })).max(5_000),
});
const json = z.record(z.string(), z.unknown());
export const FinishInput = z.object({
  step: z.literal("finish"),
  from: z.object({ host: z.string().max(200), home: z.string().max(1024) }),
  claudeSettings: json.nullable(),
  claudeMcpServers: z.record(z.string(), json),
  installedPlugins: json.nullable(),
  knownMarketplaces: json.nullable(),
  codexConfig: z.string().max(1_000_000).nullable(),
  codexAgents: z.string().max(1_000_000).nullable(),
  counts: z.object({ files: z.number().int().nonnegative(), uploaded: z.number().int().nonnegative(), skills: z.array(z.string()).max(2_000), codexSkills: z.array(z.string()).max(2_000) }),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })).max(1_000),
});
export const SyncInput = z.discriminatedUnion("step", [PlanInput, FilesInput, FinishInput]);

export type SyncSummary = {
  syncedAt: string;
  from: { host: string };
  files: { total: number; uploaded: number; skipped: { path: string; reason: string }[] };
  claude: { skills: string[]; plugins: string[]; settingsLeftOut: string[]; mcp: { kept: string[]; dropped: Dropped[] } };
  codex: { skills: string[]; configLeftOut: string[]; mcp: { kept: string[]; dropped: Dropped[] }; agentsMd: boolean };
};

const statusFile = () => path.join(sharedConfigDir(), "setup-sync.json");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function target(home: string, root: SyncRoot, rel: string) {
  const dir = path.join(home, SYNC_ROOTS[root]);
  const file = path.join(dir, rel);
  if (!file.startsWith(dir + path.sep)) throw new HttpError(400, `Invalid path ${rel}`);
  return { dir, file };
}

/** Which manifest entries differ from what is on disk here. */
export async function planSync(manifest: z.infer<typeof PlanInput>["manifest"], home = os.homedir()) {
  const need: number[] = [];
  await Promise.all(manifest.map(async (entry, i) => {
    const { file } = await target(home, entry.root, entry.path);
    try {
      const s = await stat(file);
      if (s.isFile() && s.size === entry.size && sha256(await readFile(file)) === entry.sha256) return;
    } catch { /* missing */ }
    need.push(i);
  }));
  return { need: need.sort((a, b) => a - b) };
}

/** Write uploaded files, refusing any whose real parent folder is outside its root (a symlink out). */
export async function writeSyncFiles(files: z.infer<typeof FilesInput>["files"], home = os.homedir()) {
  for (const f of files) {
    const { dir, file } = await target(home, f.root, f.path);
    await mkdir(path.dirname(file), { recursive: true });
    const [realDir, realParent] = await Promise.all([realpath(dir), realpath(path.dirname(file))]);
    if (realParent !== realDir && !realParent.startsWith(realDir + path.sep)) throw new HttpError(400, `Invalid path ${f.path}`);
    const tmp = `${file}.thunk-sync-${process.pid}`;
    await writeFile(tmp, Buffer.from(f.data, "base64"), { mode: f.executable ? 0o755 : 0o644 });
    await rename(tmp, file);
  }
  return { written: files.length };
}

/** Whether this machine can run `command`: a path that exists, or a name on PATH. */
export function hasCommand(command: string) {
  if (command.includes("/")) return existsSync(command);
  return spawnSync("sh", ["-c", 'command -v "$0" >/dev/null 2>&1', command]).status === 0;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** Replace a file, keeping the old one as `<file>.bak-<time>`. Unchanged files are left alone. */
async function replace(file: string, content: string, mode = 0o644) {
  const old = await readFile(file, "utf8").catch(() => null);
  if (old === content) return;
  await mkdir(path.dirname(file), { recursive: true });
  if (old !== null) await copyFile(file, `${file}.bak-${stamp()}`);
  await writeFile(file, content, { mode });
  await chmod(file, mode);
}

const enabledPlugins = (settings: Record<string, unknown> | null) =>
  Object.entries((settings?.enabledPlugins ?? {}) as Record<string, unknown>).filter(([, on]) => on === true).map(([name]) => name);

/** Apply the settings files from a sync, keep only what can run here, and turn on the user's Claude setup. */
export async function finishSync(input: z.infer<typeof FinishInput>, { home = os.homedir(), has = hasCommand } = {}): Promise<SyncSummary> {
  const fromHome = input.from.home;
  const claude = portableServers(input.claudeMcpServers, has);
  const settings = input.claudeSettings && serverClaudeSettings(input.claudeSettings);
  if (settings) await replace(path.join(home, ".claude/settings.json"), JSON.stringify(rehome(settings.settings, fromHome, home), null, 2) + "\n");
  if (input.installedPlugins) await replace(path.join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify(rehome(input.installedPlugins, fromHome, home), null, 2) + "\n");
  if (input.knownMarketplaces) await replace(path.join(home, ".claude/plugins/known_marketplaces.json"), JSON.stringify(rehome(input.knownMarketplaces, fromHome, home), null, 2) + "\n");

  // ~/.claude.json also holds this machine's own Claude state: only its user-level MCP servers change.
  const claudeJson = path.join(home, ".claude.json");
  const current = JSON.parse((await readFile(claudeJson, "utf8").catch(() => null)) ?? "{}");
  const next = { ...current, mcpServers: { ...(current.mcpServers ?? {}), ...claude.kept } };
  if (JSON.stringify(next) !== JSON.stringify(current)) await replace(claudeJson, JSON.stringify(next, null, 2), 0o600);

  let codex = { kept: {} as Record<string, unknown>, dropped: [] as Dropped[] };
  let configLeftOut: string[] = [];
  if (input.codexConfig) {
    codex = portableServers(codexMcpServers(input.codexConfig), has);
    const config = serverCodexConfig(input.codexConfig, new Set(Object.keys(codex.kept)));
    configLeftOut = config.dropped;
    await replace(path.join(home, ".codex/config.toml"), rehome(config.text, fromHome, home), 0o600);
  }
  if (input.codexAgents) await replace(path.join(home, ".codex/AGENTS.md"), input.codexAgents);

  await updateAgentSettings({ claudeUserConfig: true });
  const summary: SyncSummary = {
    syncedAt: new Date().toISOString(),
    from: { host: input.from.host },
    files: { total: input.counts.files, uploaded: input.counts.uploaded, skipped: input.skipped },
    claude: { skills: input.counts.skills, plugins: enabledPlugins(input.claudeSettings), settingsLeftOut: settings?.dropped ?? [], mcp: { kept: Object.keys(claude.kept), dropped: claude.dropped } },
    codex: { skills: input.counts.codexSkills, configLeftOut, mcp: { kept: Object.keys(codex.kept), dropped: codex.dropped }, agentsMd: !!input.codexAgents },
  };
  await mkdir(sharedConfigDir(), { recursive: true, mode: 0o700 });
  await writeFile(statusFile(), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  return summary;
}

const listDirs = (dir: string) => readdir(dir, { withFileTypes: true })
  .then((entries) => entries.filter((e) => !e.name.startsWith(".") && e.name !== "synced" && (e.isDirectory() || e.isSymbolicLink())).map((e) => e.name).sort())
  .catch(() => [] as string[]);
const readJson = (file: string) => readFile(file, "utf8").then((t) => JSON.parse(t) as Record<string, unknown>).catch(() => null);

/** What Claude and Codex sessions on this machine get from the user's own setup, and the last sync. */
export async function setupStatus(home = os.homedir()) {
  const [agent, lastSync, skills, codexSkills, settings, claudeJson, codexConfig] = await Promise.all([
    readAgentSettings(),
    readJson(statusFile()) as Promise<SyncSummary | null>,
    listDirs(path.join(home, ".claude/skills")),
    listDirs(path.join(home, ".codex/skills")),
    readJson(path.join(home, ".claude/settings.json")),
    readJson(path.join(home, ".claude.json")),
    readFile(path.join(home, ".codex/config.toml"), "utf8").catch(() => null),
  ]);
  return {
    claudeUserConfig: agent.claudeUserConfig,
    host: os.hostname(),
    here: {
      claude: { skills, plugins: enabledPlugins(settings), mcpServers: Object.keys((claudeJson?.mcpServers ?? {}) as object).sort() },
      codex: { skills: codexSkills, mcpServers: codexConfig ? Object.keys(codexMcpServers(codexConfig)).sort() : [] },
    },
    lastSync,
  };
}
export type SetupStatus = Awaited<ReturnType<typeof setupStatus>>;
