import "server-only";
import { mkdir } from "node:fs/promises";
import { createSdkMcpServer, tool, type Options, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { loadSessionNotes, notesPrompt, type SessionNotes } from "@/lib/notes/prompt";
import { readMemory } from "@/lib/projects/memory";
import { projectMemoryDir, projectMemoryFile, workspaceMemoryDir } from "@/lib/projects/paths";
import { routineSystemPrompt } from "@/lib/routines/prompt";
import { tasksTools } from "@/lib/tasks/tools";
import { tasksPrompt } from "@/lib/tasks/prompt";
import { tasksForWorkspace } from "@/lib/tasks/service";
import { extraRepoDirectories, extraReposPrompt } from "@/lib/projects/repos-prompt";
import type { Task } from "@/lib/tasks/types";
import { vaultDirOf } from "@/lib/vault/dir";
import { listItems } from "@/lib/vault/store";
import { vaultPrompt, vaultTools } from "@/lib/vault/tools";
import type { VaultItem } from "@/lib/vault/types";
import { buildCanUseTool } from "./permissions";
import type { LiveSession } from "./session-registry";
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

export function hierarchyPrompt(
  live: LiveSession,
  projectMemory: string,
  provider: AgentProvider = "claude",
  notes?: SessionNotes,
  tasks: Task[] = [],
  vault?: { items: VaultItem[]; dir: string },
) {
  const { project, workspace } = live.ctx;
  const pmFile = projectMemoryFile(project.root);
  const wmDir = workspaceMemoryDir(project.root, workspace.slug);
  const lines = [
    "# Thunk hierarchy",
    `Project: **${project.name}** (${project.kind}) at \`${project.root}\`${project.remote ? ` · remote ${project.remote}` : ""}.`,
    workspace.worktreePath
      ? `Workspace: **${workspace.name}** · git worktree at \`${workspace.worktreePath}\` on branch \`${workspace.branch}\` (branched from \`${workspace.baseRef}\`). Your cwd is the worktree${provider === "claude" ? "; the project's CLAUDE.md and .claude/ config come from the main checkout" : ""}. Do not switch branches or cd into the main checkout.`
      : `Workspace: **${workspace.name}** · works directly in the project root (no worktree).`,
    ...extraReposPrompt(workspace),
    "",
    "Two memory scopes, both plain markdown files you may read and edit with your file tools:",
    `- Project memory: \`${pmFile}\`. Facts that hold for the whole repo/folder across every workspace: architecture, conventions, gotchas, decisions. Keep it short and durable; edit in place rather than appending logs.`,
    `- Workspace memory${provider === "claude" ? " (your auto-memory directory)" : ""}: \`${wmDir}\`${provider === "codex" ? " (keep it in MEMORY.md there)" : ""}. Shared by every session in this workspace: what the task is, what has been done, what's next, open questions. Other sessions in this workspace read it, so keep it current.`,
    "",
    "When you learn something durable about the project, put it in project memory. When you make progress or decisions on this workspace's task, put it in workspace memory.",
  ];
  if (projectMemory.trim()) lines.push("", "## Project memory (current contents)", projectMemory.trim());
  if (notes) lines.push("", notesPrompt(notes));
  lines.push("", tasksPrompt(tasks));
  if (vault) lines.push("", vaultPrompt(vault.items, vault.dir));
  return lines.join("\n");
}

export async function buildOptions(live: LiveSession, { resume }: { resume?: string }): Promise<Options> {
  const { project, workspace } = live.ctx;
  const vaultDir = vaultDirOf(project);
  const [projectMemory, notes, tasks, vaultItems] = await Promise.all([
    readMemory(projectMemoryFile(project.root)),
    loadSessionNotes(project, workspace),
    tasksForWorkspace(workspace.id),
    listItems(vaultDir).catch(() => []),
  ]);
  await mkdir(vaultDir.dir, { recursive: true }).catch(() => {});
  const isWorktree = Boolean(workspace.worktreePath);

  return {
    cwd: workspace.cwd,
    // In a worktree, CLAUDE.md / .claude / .mcp.json still come from the trusted main checkout.
    ...(isWorktree ? { projectConfigRoot: project.root } : {}),
    // Project memory and notes live outside the repo; grant file-tool access to them.
    // Extra repos of a multi-repo workspace are working directories too.
    additionalDirectories: [projectMemoryDir(project.root), notes.projectDir, notes.workspaceDir, ...extraRepoDirectories(workspace), ...notes.repos.filter((r) => r.extra).map((r) => r.dir)],
    mcpServers: { thunk: createSdkMcpServer({
      name: "thunk", alwaysLoad: true,
      tools: [
        ...tasksTools({ projectId: project.id, workspaceId: workspace.id, sessionId: live.id }).map((t) => tool(t.name, t.description, t.schema, t.handler)),
        ...vaultTools({ projectId: project.id }).map((t) => tool(t.name, t.description, t.schema, t.handler, { annotations: { readOnlyHint: true } })),
      ],
    }) },
    model: live.meta.model,
    permissionMode: live.meta.permissionMode as PermissionMode,
    // Lets the user switch to bypassPermissions from the mode picker later.
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    // Load the project's CLAUDE.md + .claude/settings(.local).json like Claude Code does in a repo,
    // but not ~/.claude (global plugins/hooks). Our permissionMode still wins over defaultMode.
    settingSources: ["project", "local"],
    // Auto-memory is per workspace, so every session in it shares one MEMORY.md.
    settings: {
      autoMemoryEnabled: true,
      autoMemoryDirectory: workspaceMemoryDir(project.root, workspace.slug),
      permissions: { deny: [`Edit(/${vaultDir.dir}/**)`, `Write(/${vaultDir.dir}/**)`] },
    },
    // Apply to sandboxed shell calls too; unrestricted sessions still require OS isolation.
    sandbox: { filesystem: { denyWrite: [vaultDir.dir] } },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: [
        CANVAS_PROMPT,
        hierarchyPrompt(live, projectMemory, "claude", notes, [...tasks.workspace, ...tasks.project], { items: vaultItems, dir: vaultDir.dir }),
        ...(live.meta.origin?.kind === "routine" ? [routineSystemPrompt(live.meta.origin)] : []),
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
