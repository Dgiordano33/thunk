import { boardTools, boardPrompt } from "@/lib/board/tools";
import { projectBoardsDir } from "@/lib/projects/paths";
import { chiefTools } from "@/lib/workers/tools";
import { CHIEF_DISALLOWED_TOOLS, readOnlySession, teamPrompt } from "@/lib/workers/prompt";
import { notificationTools } from "@/lib/notifications/tools";
import "server-only";
import { mkdir } from "node:fs/promises";
import { createSdkMcpServer, tool, type Options, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { loadSessionNotes, notesPrompt, type SessionNotes } from "@/lib/notes/prompt";
import { readConnectors } from "@/lib/projects/connectors";
import { readMemory } from "@/lib/projects/memory";
import { projectConfigDir, projectInstructionsFile, projectMemoryDir, projectMemoryFile, workspaceMemoryDir } from "@/lib/projects/paths";
import { routineSystemPrompt } from "@/lib/routines/prompt";
import { tasksTools } from "@/lib/tasks/tools";
import { tasksPrompt } from "@/lib/tasks/prompt";
import { tasksForWorkspace } from "@/lib/tasks/service";
import { anchorRepo } from "@/lib/projects/repos";
import { otherRepoDirectories, otherReposPrompt } from "@/lib/projects/repos-prompt";
import type { Task } from "@/lib/tasks/types";
import { vaultDirOf } from "@/lib/vault/dir";
import { listItems } from "@/lib/vault/store";
import { vaultPrompt, vaultTools } from "@/lib/vault/tools";
import type { VaultItem } from "@/lib/vault/types";
import { buildCanUseTool } from "./permissions";
import { emit, type LiveSession } from "./session-registry";
import type { AgentProvider } from "./types";

export const CANVAS_PROMPT = `
# Thunk canvas
You are running inside Thunk, a harness where your final prose in each turn is shown to the user as an editable document (a "canvas"), not a chat bubble. Write that final prose as a clean, well-structured markdown document. Avoid filler like "Let me know if...".

The user may edit the document directly and leave comments on highlighted spans, then send them back as a <document_revision> message containing a unified diff of their edits, the quoted comment threads, and the full edited document. When you receive one:
- Treat their edits as authoritative and keep them unless a comment asks otherwise.
- Address every comment. Answer questions inline where natural.
- Reply with the complete revised document in markdown (not a diff), keeping anything they did not touch. Do any tool work first; the revised document must be your final prose for the turn.
- End with a short "Notes" section only if you need to explain something that doesn't belong in the document.
`.trim();

// Claude's auto-memory only loads this much of MEMORY.md, so a longer file is injected to keep its tail.
const AUTO_MEMORY_MAX_LINES = 200;
const AUTO_MEMORY_MAX_BYTES = 25_000;
const exceedsAutoMemory = (memory: string) => memory.split("\n").length > AUTO_MEMORY_MAX_LINES || Buffer.byteLength(memory) > AUTO_MEMORY_MAX_BYTES;

export function hierarchyPrompt(
  live: LiveSession,
  projectMemory: string,
  provider: AgentProvider = "claude",
  notes?: SessionNotes,
  tasks: Task[] = [],
  vault?: { items: VaultItem[]; dir: string },
  instructions = "",
) {
  const { project, workspace } = live.ctx;
  const pmFile = projectMemoryFile(project.dataKey);
  const wmDir = workspaceMemoryDir(project.dataKey, workspace.slug);
  const anchor = anchorRepo(live.ctx);
  const checkout = workspace.repos.find((r) => r.repoId === anchor?.id);
  const lines = [
    "# Thunk hierarchy",
    anchor
      ? `Project: **${project.name}** · your cwd belongs to **${anchor.name}** (${anchor.kind}) at \`${anchor.path}\`${anchor.remote ? ` · remote ${anchor.remote}` : ""}.`
      : `Project: **${project.name}**. It has no repositories yet, so your cwd is the project's own scratch directory.`,
    checkout?.worktreePath
      ? `Workspace: **${workspace.name}** · git worktree at \`${checkout.worktreePath}\` on branch \`${checkout.branch}\` (branched from \`${checkout.baseRef}\`). Your cwd is the worktree${provider === "claude" ? "; the project's CLAUDE.md and .claude/ config come from the main checkout" : ""}. Do not switch branches or cd into the main checkout.`
      : `Workspace: **${workspace.name}** · works directly in \`${workspace.cwd}\` (no worktree).`,
    ...otherReposPrompt(workspace),
    "",
    "Two memory scopes, both plain markdown files you may read and edit with your file tools:",
    `- Project memory: \`${pmFile}\`. Facts that hold for the whole repo/folder across every workspace: architecture, conventions, gotchas, decisions. Keep it short and durable; edit in place rather than appending logs.${provider === "claude" ? " This is also your auto-memory directory, so what you save on your own lands here." : ""}`,
    `- Workspace task log: \`${wmDir}\`${provider === "codex" ? " (keep it in MEMORY.md there)" : ""}. Shared by every session in this workspace: what the task is, what has been done, what's next, open questions. Read MEMORY.md here at the start of a task and update it as you go.`,
    "",
    "When you learn something durable about the project, put it in project memory. When you make progress or decisions on this workspace's task, put it in workspace memory.",
  ];
  if (instructions.trim()) lines.push("", "## Project instructions", instructions.slice(0, 24_000), ...(instructions.length > 24_000 ? ["[Project instructions truncated at 24,000 characters.]"] : []));
  const memory = projectMemory.trim();
  if (memory && (provider === "codex" || exceedsAutoMemory(memory))) lines.push("", "## Project memory (current contents)", memory);
  if (notes) lines.push("", notesPrompt(notes));
  lines.push("", tasksPrompt(tasks));
  if (vault) lines.push("", vaultPrompt(vault.items, vault.dir));
  return lines.join("\n");
}

export async function buildOptions(live: LiveSession, { resume }: { resume?: string }): Promise<Options> {
  const { project, workspace } = live.ctx;
  const vaultDir = vaultDirOf(project);
  const [projectMemory, notes, tasks, vaultItems, instructions, connectors] = await Promise.all([
    readMemory(projectMemoryFile(project.dataKey)),
    loadSessionNotes(project, workspace),
    tasksForWorkspace(workspace.id),
    listItems(vaultDir).catch(() => []),
    readMemory(projectInstructionsFile(project.dataKey)),
    readConnectors(project.dataKey),
  ]);
  await mkdir(vaultDir.dir, { recursive: true }).catch(() => {});
  const anchor = anchorRepo(live.ctx);
  const isWorktree = Boolean(workspace.repos.find((r) => r.repoId === anchor?.id)?.worktreePath);

  return {
    cwd: live.meta.cwd,
    // In a worktree, CLAUDE.md / .claude / .mcp.json still come from the trusted main checkout.
    ...(isWorktree && anchor ? { projectConfigRoot: anchor.path } : {}),
    // Project memory and notes live outside the repo; grant file-tool access to them.
    // The other repos of a multi-repo workspace are working directories too.
    additionalDirectories: [...(live.meta.origin?.kind === "board" ? [projectBoardsDir(project.dataKey)] : []), projectMemoryDir(project.dataKey), workspaceMemoryDir(project.dataKey, workspace.slug), notes.projectDir, notes.workspaceDir, ...otherRepoDirectories(workspace), ...notes.repos.filter((r) => r.extra).map((r) => r.dir)],
    mcpServers: { ...connectors.config.mcpServers, thunk: createSdkMcpServer({
      name: "thunk", alwaysLoad: true,
      tools: [
        ...boardTools(live, emit).map(t => tool(t.name, t.description, t.schema, t.handler)),
        ...chiefTools(live).map((t) => tool(t.name, t.description, t.schema, t.handler)),
        ...notificationTools({ projectId: project.id, workspaceId: workspace.id, sessionId: live.id }).map((t) => tool(t.name, t.description, t.schema, t.handler)),
        ...tasksTools({ projectId: project.id, workspaceId: workspace.id, sessionId: live.id, routine: live.meta.origin?.kind === "routine" }).map((t) => tool(t.name, t.description, t.schema, t.handler)),
        ...vaultTools({ projectId: project.id }).map((t) => tool(t.name, t.description, t.schema, t.handler, { annotations: { readOnlyHint: true } })),
      ],
    }) },
    ...(readOnlySession(live.meta.origin) ? { disallowedTools: CHIEF_DISALLOWED_TOOLS } : {}),
    model: live.meta.model,
    permissionMode: live.meta.permissionMode as PermissionMode,
    // Lets the user switch to bypassPermissions from the mode picker later.
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    // Load the project's CLAUDE.md + .claude/settings(.local).json like Claude Code does in a repo,
    // but not ~/.claude (global plugins/hooks). Our permissionMode still wins over defaultMode.
    settingSources: ["project", "local"],
    // Auto-memory is durable project knowledge shared across workspaces.
    settings: {
      autoMemoryEnabled: true,
      autoMemoryDirectory: projectMemoryDir(project.dataKey),
      permissions: { deny: [`Edit(/${vaultDir.dir}/**)`, `Write(/${vaultDir.dir}/**)`, `Edit(/${projectConfigDir(project.dataKey)}/**)`, `Write(/${projectConfigDir(project.dataKey)}/**)`] },
    },
    // Apply to sandboxed shell calls too; unrestricted sessions still require OS isolation.
    sandbox: { filesystem: { denyWrite: [vaultDir.dir, projectConfigDir(project.dataKey)] } },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: [
        live.meta.origin?.kind === "board" ? boardPrompt : CANVAS_PROMPT,
        hierarchyPrompt(live, projectMemory, "claude", notes, [...tasks.workspace, ...tasks.project], { items: vaultItems, dir: vaultDir.dir }, instructions),
        ...(live.meta.origin?.kind === "routine" ? [routineSystemPrompt(live.meta.origin)] : []),
        teamPrompt(live.meta.origin),
      ].join("\n\n"),
    },
    // `env` replaces process.env entirely, so always spread it.
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "thunk/0.1.0" },
    resume,
    canUseTool: buildCanUseTool(live),
    stderr: (data) => {
      live.stderrTail.push(data);
      if (live.stderrTail.length > 50) live.stderrTail.shift();
    },
  };
}
