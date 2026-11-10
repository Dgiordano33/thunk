import { chiefTools } from "@/lib/workers/tools";
import { teamPrompt } from "@/lib/workers/prompt";
import { notificationTools } from "@/lib/notifications/tools";
import type { PromptImage } from "@/lib/prompts/schema";
import "server-only";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { tasksTools } from "@/lib/tasks/tools";
import { vaultDirOf } from "@/lib/vault/dir";
import { listItems } from "@/lib/vault/store";
import { vaultTools } from "@/lib/vault/tools";
import { tasksForWorkspace } from "@/lib/tasks/service";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadSessionNotes } from "@/lib/notes/prompt";
import { readConnectors, codexConnectors } from "@/lib/projects/connectors";
import { readMemory } from "@/lib/projects/memory";
import { projectInstructionsFile, projectMemoryDir, projectMemoryFile, workspaceMemoryDir, workspaceMemoryFile } from "@/lib/projects/paths";
import { routineSystemPrompt } from "@/lib/routines/prompt";
import { appendText, ensureTurn, finishTurn, stringifyToolResult } from "../event-bridge";
import { CANVAS_PROMPT, hierarchyPrompt } from "../options";
import { otherRepoDirectories } from "@/lib/projects/repos-prompt";
import { emit, setState, type AgentDriver, type LiveSession, type PendingRequest } from "../session-registry";
import { CodexRpc, type RpcId } from "./rpc";

/* Minimal slices of the app-server protocol (`codex app-server generate-ts`) that Thunk reads. */
type Item = { id: string; type: string; [k: string]: unknown };
/** Protocol payload fields we read without full types; `never` reads assign to whatever we expect. */
type Fields = Record<string, never>;
type Turn = { id: string; status: "completed" | "interrupted" | "failed" | "inProgress"; error: { message: string } | null; durationMs: number | null };
type ApprovalPolicy = "untrusted" | "on-request" | "never";
type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "workspaceWrite"; writableRoots: string[]; networkAccess: boolean; excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean };

/**
 * Harness modes → Codex approval policy. Codex always sandboxes; "ask" means it
 * prompts for anything outside its trusted set or the sandbox.
 */
const APPROVAL: Record<string, ApprovalPolicy> = {
  default: "untrusted",
  acceptEdits: "on-request",
  bypassPermissions: "never",
};

/** Unwrap `/bin/zsh -lc <script>` so tool rows show the command the model wrote. */
function unwrapShell(command: string) {
  const m = /^\S*\/(?:ba|z)?sh -l?c ([\s\S]+)$/.exec(command);
  return (m && shellWord(m[1])) ?? command;
}

/** Decode one POSIX shell word ('…', "…", \x, bare). Null if `src` isn't exactly one word. */
function shellWord(src: string): string | null {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) return null;
      out += src.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && '$`"\\\n'.includes(src[i + 1] ?? "")) i++;
        out += src[i++];
      }
      if (i >= src.length) return null;
      i++;
    } else if (c === "\\") {
      out += src[i + 1] ?? "";
      i += 2;
    } else if (/\s/.test(c)) {
      return null;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Codex thread items that are tool calls, as a harness tool name + input. */
function toolCall(item: Item): { name: string; input: Record<string, unknown> } | null {
  const i = item as unknown as Fields;
  switch (item.type) {
    case "commandExecution":
      return { name: "Bash", input: { command: unwrapShell(i.command), cwd: i.cwd } };
    case "fileChange":
      return {
        name: "ApplyPatch",
        input: {
          changes: ((i.changes ?? []) as { path: string; kind: { type: string }; diff: string }[]).map((c) => ({
            path: c.path,
            kind: c.kind.type,
            diff: c.diff,
          })),
        },
      };
    case "mcpToolCall":
      return { name: `mcp__${i.server}__${i.tool}`, input: (i.arguments ?? {}) as Record<string, unknown> };
    case "dynamicToolCall":
      return { name: i.tool, input: (i.arguments ?? {}) as Record<string, unknown> };
    case "webSearch":
      return { name: "WebSearch", input: { query: i.query } };
    case "collabAgentToolCall":
      return { name: "Agent", input: { description: i.prompt ?? i.tool, tool: i.tool, model: i.model } };
    case "imageView":
      return { name: "Read", input: { file_path: i.path } };
    case "imageGeneration":
      return { name: "ImageGeneration", input: { prompt: i.revisedPrompt } };
    default:
      return null;
  }
}

function toolResult(item: Item): { content: string; isError: boolean } {
  const i = item as unknown as Fields;
  const failed = i.status === "failed" || i.status === "declined";
  switch (item.type) {
    case "commandExecution": {
      const exit = i.exitCode as number | null;
      const out = (i.aggregatedOutput as string | null) ?? "";
      return {
        content: stringifyToolResult(out || (i.status === "declined" ? "Declined." : exit != null ? `Exit code ${exit}` : "")),
        isError: failed || (exit != null && exit !== 0),
      };
    }
    case "fileChange":
      return {
        content: failed
          ? `Patch ${i.status}.`
          : ((i.changes ?? []) as { path: string; kind: { type: string } }[])
              .map((c) => `${c.kind.type} ${c.path}`)
              .join("\n"),
        isError: failed,
      };
    case "mcpToolCall": {
      const err = i.error as { message: string } | null;
      const res = i.result as { content: unknown } | null;
      return { content: err ? err.message : stringifyToolResult(res?.content ?? ""), isError: Boolean(err) || failed };
    }
    case "dynamicToolCall":
      return { content: stringifyToolResult(i.contentItems ?? ""), isError: i.success === false };
    default:
      return { content: "", isError: failed };
  }
}

/**
 * Codex runtime: one `codex app-server` process per session, driving a single
 * thread over JSON-RPC and translating its item stream into harness events.
 */
export async function createCodexDriver(live: LiveSession, { resume }: { resume?: string }): Promise<AgentDriver> {
  const { project, workspace } = live.ctx;
  const [projectMemory, workspaceMemory, notes, tasks, vaultItems, instructions, connectors] = await Promise.all([
    readMemory(projectMemoryFile(project.dataKey)),
    readMemory(workspaceMemoryFile(project.dataKey, workspace.slug)),
    loadSessionNotes(project, workspace),
    tasksForWorkspace(workspace.id),
    listItems(vaultDirOf(project)).catch(() => []),
    readMemory(projectInstructionsFile(project.dataKey)),
    readConnectors(project.dataKey),
  ]);
  const dataDirs = [projectMemoryDir(project.dataKey), workspaceMemoryDir(project.dataKey, workspace.slug), notes.projectDir, notes.workspaceDir, ...notes.repos.filter((r) => r.extra).map((r) => r.dir)];
  await Promise.all(dataDirs.map((d) => mkdir(d, { recursive: true })));
  // The other repos are writable, plus each worktree's .git (its metadata lives in the main checkout; commits write there).
  const writableRoots = [...dataDirs, ...otherRepoDirectories(workspace)];
  for (const checkout of workspace.repos) {
    const repo = project.repos.find((r) => r.id === checkout.repoId);
    if (checkout.worktreePath && repo) writableRoots.push(path.join(repo.path, ".git"));
  }

  const developerInstructions = [
    CANVAS_PROMPT,
    hierarchyPrompt(live, projectMemory, "codex", notes, [...tasks.workspace, ...tasks.project], { items: vaultItems, dir: vaultDirOf(project).dir }, instructions),
    ...(workspaceMemory.trim() ? ["## Workspace memory (current contents)", workspaceMemory.trim()] : []),
    teamPrompt(live.meta.origin),
    ...(live.meta.origin?.kind === "routine" ? [routineSystemPrompt(live.meta.origin)] : []),
  ].join("\n\n");

  const taskTools = [...chiefTools(live), ...notificationTools({ projectId: project.id, workspaceId: workspace.id, sessionId: live.id }), ...tasksTools({ projectId: project.id, workspaceId: workspace.id, sessionId: live.id }), ...vaultTools({ projectId: project.id })];
  let closed = false;
  let threadId: string | null = null;
  let activeTurnId: string | null = null;
  let turnErrored = false;
  /** Agent messages that streamed deltas, so `item/completed` doesn't append their text twice. */
  const streamedItems = new Set<string>();
  /** Tool inputs by item id, shown again on the approval card. */
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>();
  /** Tool calls still running, closed out if the turn ends without completing them (interrupts). */
  const openTools = new Set<string>();
  /** App-server request id → harness pending request id, to cancel cards the server resolves itself. */
  const rpcToRequest = new Map<RpcId, string>();

  const sandboxPolicy = (): SandboxPolicy =>
    live.meta.permissionMode === "bypassPermissions"
      ? { type: "dangerFullAccess" }
      : { type: "workspaceWrite", writableRoots, networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
  const approvalPolicy = () => APPROVAL[live.meta.permissionMode] ?? "untrusted";

  const rpc = new CodexRpc({
    cwd: live.meta.cwd,
    onStderr: (data) => {
      live.stderrTail.push(data.replace(/\x1b\[[0-9;]*m/g, ""));
      if (live.stderrTail.length > 50) live.stderrTail.shift();
    },
    onNotification: (method, params) => handleNotification(method, params as Fields),
    onRequest: (method, params, id) => handleRequest(method, params as Fields, id),
  });

  function handleNotification(method: string, p: Fields) {
    if (p.threadId && threadId && p.threadId !== threadId) return; // sub-agent threads
    switch (method) {
      case "turn/started": {
        activeTurnId = (p.turn as Turn).id;
        turnErrored = false;
        ensureTurn(live, true);
        return;
      }
      case "item/started": {
        const item = p.item as Item;
        if (item.type === "userMessage") return;
        const turn = ensureTurn(live, true);
        if (item.type === "agentMessage") {
          if (turn.segmentText && !turn.lastPartWasTool) appendText(live, turn, "\n\n");
          return;
        }
        const call = toolCall(item);
        if (!call) return;
        toolInputs.set(item.id, call);
        openTools.add(item.id);
        turn.lastPartWasTool = true;
        emit(live, { type: "tool_use", turnId: turn.id, toolUseId: item.id, name: call.name, input: call.input });
        return;
      }
      case "item/agentMessage/delta": {
        streamedItems.add(p.itemId);
        appendText(live, ensureTurn(live), p.delta);
        return;
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        emit(live, { type: "thinking_delta", turnId: ensureTurn(live).id, text: p.delta });
        return;
      case "item/completed": {
        const item = p.item as Item;
        if (item.type === "agentMessage") {
          if (!streamedItems.delete(item.id) && typeof item.text === "string" && item.text) {
            const turn = ensureTurn(live);
            if (turn.segmentText && !turn.lastPartWasTool) appendText(live, turn, "\n\n");
            appendText(live, turn, item.text);
          }
          return;
        }
        if (!toolInputs.has(item.id)) return;
        // Codex reports the final patch on completion; refresh the stored input for late approvals.
        const call = toolCall(item);
        if (call) toolInputs.set(item.id, call);
        openTools.delete(item.id);
        emit(live, { type: "tool_result", toolUseId: item.id, ...toolResult(item) });
        return;
      }
      case "turn/completed": {
        const t = p.turn as Turn;
        if (activeTurnId === t.id) activeTurnId = null;
        for (const id of openTools)
          emit(live, { type: "tool_result", toolUseId: id, content: `Turn ${t.status}.`, isError: true });
        openTools.clear();
        if (t.status === "failed" && t.error && !turnErrored) emit(live, { type: "error", message: t.error.message });
        if (live.turn) finishTurn(live, live.turn, true);
        emit(live, {
          type: "result",
          subtype: t.status === "completed" ? "success" : t.status,
          isError: t.status === "failed",
          costUsd: 0, // Codex reports tokens, not dollars.
          numTurns: 1,
          durationMs: t.durationMs ?? 0,
        });
        if (live.pending.size === 0) setState(live, "idle");
        return;
      }
      case "error": {
        if (p.willRetry) return;
        turnErrored = true;
        emit(live, { type: "error", message: (p.error as { message: string }).message });
        return;
      }
      case "model/rerouted": {
        live.meta.model = p.toModel;
        setState(live, live.meta.status);
        return;
      }
      case "serverRequest/resolved": {
        const requestId = rpcToRequest.get(p.requestId);
        if (!requestId) return;
        rpcToRequest.delete(p.requestId);
        const req = live.pending.get(requestId);
        if (!req) return;
        live.pending.delete(requestId);
        req.resolve({ behavior: "deny", message: "The request was cancelled." });
        emit(live, { type: "permission_resolved", requestId, decision: "cancelled" });
        if (live.pending.size === 0 && live.meta.status === "awaiting") setState(live, "running");
        return;
      }
    }
  }

  /** Park an approval as a harness permission request; resolves when the user decides. */
  function askPermission(rpcId: RpcId, toolUseId: string, toolName: string, input: Record<string, unknown>, reason?: string | null) {
    const requestId = crypto.randomUUID();
    rpcToRequest.set(rpcId, requestId);
    emit(live, {
      type: "permission_request",
      requestId,
      toolUseId,
      toolName,
      input,
      description: reason ?? undefined,
      // Lets the card offer "Allow for this session" (Codex's acceptForSession).
      suggestions: [{ type: "session" }],
    });
    setState(live, "awaiting");
    return new Promise<PermissionResult>((resolve) => {
      const req: PendingRequest = {
        kind: "permission",
        toolName,
        toolUseId,
        input,
        suggestions: [{ type: "session" }],
        resolve: (result) => {
          rpcToRequest.delete(rpcId);
          resolve(result);
        },
      };
      live.pending.set(requestId, req);
    });
  }

  /** A deny with a note: Codex has no denial message, so steer the turn with it. */
  function relayDenial(result: PermissionResult) {
    if (result.behavior !== "deny") return;
    const note = /said: ([\s\S]+)$/.exec(result.message)?.[1];
    if (note && activeTurnId && threadId)
      rpc
        .request("turn/steer", { threadId, expectedTurnId: activeTurnId, input: [textInput(note)] })
        .catch(() => {});
  }

  const decision = (r: PermissionResult) =>
    r.behavior === "deny" ? "decline" : r.updatedPermissions?.length ? "acceptForSession" : "accept";

  async function handleRequest(method: string, p: Fields, id: RpcId): Promise<unknown> {
    switch (method) {
      case "item/tool/call": {
        const taskTool = taskTools.find((t) => t.name === p.tool);
        if (p.threadId !== threadId || p.namespace != null || !taskTool)
          return { contentItems: [{ type: "inputText", text: "Unknown task tool or thread." }], success: false };
        const result = await taskTool.handler(p.arguments);
        return { contentItems: result.content.map(({ text }) => ({ type: "inputText", text })), success: !result.isError };
      }
      case "item/commandExecution/requestApproval": {
        const known = toolInputs.get(p.itemId)?.input;
        const command = p.command ? unwrapShell(p.command) : known?.command;
        const result = await askPermission(id, p.itemId, "Bash", { command, cwd: p.cwd ?? known?.cwd }, p.reason);
        relayDenial(result);
        return { decision: decision(result) };
      }
      case "item/fileChange/requestApproval": {
        const input = toolInputs.get(p.itemId)?.input ?? {};
        const result = await askPermission(id, p.itemId, "ApplyPatch", input, p.reason);
        relayDenial(result);
        return { decision: decision(result) };
      }
      case "item/permissions/requestApproval": {
        const requested = p.permissions as { network: unknown; fileSystem: unknown };
        const result = await askPermission(id, p.itemId, "Permissions", { ...requested, cwd: p.cwd }, p.reason);
        relayDenial(result);
        if (result.behavior === "deny") return { permissions: {}, scope: "turn" };
        return {
          permissions: Object.fromEntries(Object.entries(requested).filter(([, v]) => v != null)),
          scope: result.updatedPermissions?.length ? "session" : "turn",
        };
      }
      case "item/tool/requestUserInput":
        return { answers: {} };
      case "mcpServer/elicitation/request":
        return { action: "decline", content: null, _meta: null };
      default:
        throw new Error(`Thunk does not handle ${method}`);
    }
  }

  const textInput = (text: string) => ({ type: "text", text, text_elements: [] });

  const ready = (async () => {
    // Dynamic tools are experimental in the installed app-server protocol.
    await rpc.request("initialize", {
      clientInfo: { name: "thunk", title: "Thunk", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    rpc.notify("initialized");
    const params = {
      model: live.meta.model,
      cwd: live.meta.cwd,
      approvalPolicy: approvalPolicy(),
      sandbox: live.meta.permissionMode === "bypassPermissions" ? "danger-full-access" : "workspace-write",
      developerInstructions,
      config: { mcp_servers: codexConnectors(connectors.config) },
    };
    const res = await rpc.request<{ thread: { id: string }; model: string; cwd: string }>(
      resume ? "thread/resume" : "thread/start",
      // Resume restores persisted tools; its protocol has no dynamicTools field.
      // shortcut: pre-task threads lack tools, start a new session to register them.
      resume ? { ...params, threadId: resume, excludeTurns: true } : {
        ...params,
        dynamicTools: taskTools.map((t) => ({
          type: "function", name: t.name, description: t.description,
          inputSchema: z.toJSONSchema(z.strictObject(t.schema)), deferLoading: false,
        })),
      },
    );
    threadId = res.thread.id;
    const changed =
      live.meta.sdkSessionId !== threadId ||
      live.meta.model !== res.model ||
      !live.events.some((e) => e.type === "init");
    live.meta.sdkSessionId = threadId;
    live.meta.model = res.model;
    if (changed)
      emit(live, {
        type: "init",
        sdkSessionId: threadId,
        model: res.model,
        cwd: res.cwd,
        permissionMode: live.meta.permissionMode,
        tools: [],
      });
  })();
  // Surfaced by run(); keep the floating promise from crashing the process.
  ready.catch(() => {});

  let sends: Promise<unknown> = ready;

  async function sendNow(content: string, images: PromptImage[]) {
    if (!threadId) return;
    const input = [...(content ? [textInput(content)] : []), ...images.map((image) => ({ type: "image", url: image.url }))];
    if (activeTurnId) {
      // Mid-turn follow-up: steer the running turn instead of queueing a new one.
      const ok = await rpc
        .request("turn/steer", { threadId, expectedTurnId: activeTurnId, input })
        .then(() => true, () => false);
      if (ok) return;
    }
    const res = await rpc.request<{ turn: Turn }>("turn/start", {
      threadId,
      input,
      model: live.meta.model,
      approvalPolicy: approvalPolicy(),
      sandboxPolicy: sandboxPolicy(),
    });
    if (res.turn.status === "inProgress") activeTurnId = res.turn.id;
  }

  return {
    async run() {
      await ready;
      const { code, killed } = await rpc.exited;
      if (!killed) throw new Error(`codex app-server exited unexpectedly (code ${code})`);
    },
    send(content, images = []) {
      sends = sends
        .then(() => sendNow(content, images))
        .catch((err: Error) => {
          emit(live, { type: "error", message: err.message });
          if (live.meta.status === "running" && !activeTurnId) setState(live, "idle");
        });
    },
    async interrupt() {
      if (threadId && activeTurnId) await rpc.request("turn/interrupt", { threadId, turnId: activeTurnId });
    },
    // Model and mode apply from the next turn (turn/start overrides persist on the thread).
    async setModel() {},
    async setPermissionMode() {},
    close() {
      closed = true;
      rpc.kill();
    },
    get isClosed() {
      return closed;
    },
  };
}
