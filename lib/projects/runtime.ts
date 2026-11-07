import "server-only";
import { spawn, type IPty } from "node-pty";
import { createServer, createConnection } from "node:net";
import { copyWorkspaceFiles, readLifecycleConfig } from "./lifecycle-config";
import type { WorkspaceContext } from "./index";
import type { ProcessKind, ProcessSnapshot, RuntimeSnapshot } from "./runtime-types";

type WorkspaceProcess = ProcessSnapshot & { pty: IPty; done: Promise<number> };
type Runtime = { port: number; processes: Map<ProcessKind, WorkspaceProcess>; setupError: string | null; busy: boolean };
const globalRuntime = globalThis as typeof globalThis & { __thunkRuntime?: Map<string, Runtime>; __thunkRuntimeExit?: boolean };
const runtimes = (globalRuntime.__thunkRuntime ??= new Map());
// shortcut: retain the last 256 KiB per process; add durable scrollback if longer logs are needed.
const OUTPUT_LIMIT = 256 * 1024;

function runtime(id: string) {
  let state = runtimes.get(id);
  if (!state) {
    state = { port: 0, processes: new Map(), setupError: null, busy: false };
    runtimes.set(id, state);
  }
  return state;
}

export async function withWorkspaceLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  const state = runtime(id);
  if (state.busy) throw new Error("A workspace operation is already running");
  state.busy = true;
  try { return await action(); } finally { state.busy = false; }
}

async function allocatePort(state: Runtime) {
  if (state.port) return state.port;
  // shortcut: reserve in this server only; retry Run if another application takes the port before launch.
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close((err) => err ? reject(err) : resolve(port));
      });
    });
    if (![...runtimes.values()].some((r) => r.port === port)) return (state.port = port);
  }
}

export function processEnvironment(ctx: WorkspaceContext, port: number) {
  const { project, workspace: ws } = ctx;
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    THUNK_WORKSPACE_ID: ws.id, THUNK_WORKSPACE_NAME: ws.name, THUNK_WORKSPACE_PATH: ws.cwd,
    THUNK_ROOT_PATH: project.root, THUNK_DEFAULT_BRANCH: project.defaultBranch ?? "", THUNK_PORT: String(port),
    CONDUCTOR_WORKSPACE_ID: ws.id, CONDUCTOR_WORKSPACE_NAME: ws.name, CONDUCTOR_WORKSPACE_PATH: ws.cwd,
    CONDUCTOR_ROOT_PATH: project.root, CONDUCTOR_DEFAULT_BRANCH: project.defaultBranch ?? "",
    CONDUCTOR_PORT: String(port), CONDUCTOR_IS_LOCAL: "1", PORT: String(port), TERM: "xterm-256color",
  };
}

async function launch(ctx: WorkspaceContext, kind: ProcessKind, command: string) {
  const state = runtime(ctx.workspace.id);
  if (state.processes.get(kind)?.running) throw new Error(`${kind} is already running`);
  const port = await allocatePort(state);
  const shell = process.env.SHELL || "/bin/bash";
  const pty = spawn(shell, kind === "shell" ? ["-l"] : ["-lc", command], {
    cwd: ctx.workspace.cwd, env: processEnvironment(ctx, port), cols: 100, rows: 24, name: "xterm-256color",
  });
  let finish!: (code: number) => void;
  const proc: WorkspaceProcess = {
    id: crypto.randomUUID(), kind, command, running: true, exitCode: null, output: "", offset: 0, pty,
    done: new Promise((resolve) => { finish = resolve; }),
  };
  state.processes.set(kind, proc);
  pty.onData((data) => {
    proc.output += data;
    if (proc.output.length > OUTPUT_LIMIT) {
      const removed = proc.output.length - OUTPUT_LIMIT;
      proc.output = proc.output.slice(removed);
      proc.offset += removed;
    }
  });
  pty.onExit(({ exitCode }) => { proc.running = false; proc.exitCode = exitCode; finish(exitCode); });
  return proc;
}

export async function prepareWorkspace(ctx: WorkspaceContext) {
  return withWorkspaceLock(ctx.workspace.id, async () => {
    const state = runtime(ctx.workspace.id);
    state.setupError = null;
    try {
      const config = await readLifecycleConfig(ctx.project.root);
      await copyWorkspaceFiles(ctx.project.root, ctx.workspace.cwd, config);
      if (config.scripts.setup) {
        const proc = await launch(ctx, "setup", config.scripts.setup);
        if (await proc.done !== 0) throw new Error("Setup failed. See Setup output, then retry.");
      }
    } catch (err) {
      state.setupError = (err as Error).message;
      throw err;
    }
  });
}

export async function startWorkspaceProcess(ctx: WorkspaceContext, kind: "run" | "shell") {
  return withWorkspaceLock(ctx.workspace.id, async () => {
    if (ctx.workspace.status === "archived") throw new Error("Unarchive this workspace first");
    const state = runtime(ctx.workspace.id);
    if (kind === "shell" && state.processes.get("shell")?.running) return;
    if (kind === "run" && state.setupError) throw new Error("Fix setup before running the dev server");
    const config = await readLifecycleConfig(ctx.project.root);
    const command = kind === "shell" ? process.env.SHELL || "/bin/bash" : config.scripts.run;
    if (!command) throw new Error("Set scripts.run in thunk.json at the project root");
    await launch(ctx, kind, command);
  });
}

export function terminalSnapshot(id: string, processId: string): ProcessSnapshot | null {
  const proc = [...runtime(id).processes.values()].find((p) => p.id === processId);
  if (!proc) return null;
  const { kind, command, running, exitCode, output, offset } = proc;
  return { id: proc.id, kind, command, running, exitCode, output, offset };
}

export function terminalInput(id: string, processId: string, data?: string, cols?: number, rows?: number) {
  const proc = [...runtime(id).processes.values()].find((p) => p.id === processId);
  if (!proc?.running) throw new Error("Terminal process has exited");
  if (data) proc.pty.write(data);
  if (cols && rows) proc.pty.resize(cols, rows);
}

function kill(proc: WorkspaceProcess) {
  if (!proc.running) return;
  try { process.kill(-proc.pty.pid, "SIGKILL"); } catch { try { proc.pty.kill("SIGKILL"); } catch { /* Already exited. */ } }
}

export async function stopWorkspaceProcesses(id: string, kind?: ProcessKind) {
  const processes = [...runtime(id).processes.values()].filter((proc) => !kind || proc.kind === kind);
  for (const proc of processes) kill(proc);
  await Promise.all(processes.map((proc) => proc.done));
}

export async function archiveWorkspaceProcesses(ctx: WorkspaceContext) {
  await stopWorkspaceProcesses(ctx.workspace.id);
  const config = await readLifecycleConfig(ctx.project.root);
  if (config.scripts.archive) {
    const proc = await launch(ctx, "archive", config.scripts.archive);
    if (await proc.done !== 0) throw new Error("Archive hook failed. Workspace kept; see Archive output.");
  }
}

async function portReady(port: number) {
  if (!port) return false;
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (ready: boolean) => { socket.destroy(); resolve(ready); };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

export async function runtimeSnapshot(ctx: WorkspaceContext, includeOutput = true): Promise<RuntimeSnapshot> {
  const state = runtime(ctx.workspace.id);
  let config;
  let configError: string | null = null;
  try { config = await readLifecycleConfig(ctx.project.root); }
  catch (err) { configError = (err as Error).message; config = { scripts: {} }; }
  return {
    archived: ctx.workspace.status === "archived",
    port: state.port, setupError: state.setupError || configError, busy: state.busy, scripts: config.scripts,
    previewUrl: state.processes.get("run")?.running && await portReady(state.port) ? `http://127.0.0.1:${state.port}` : null,
    processes: [...state.processes.values()].map(({ id, kind, command, running, exitCode, output, offset }) =>
      ({ id, kind, command, running, exitCode, output: includeOutput ? output : "", offset: includeOutput ? offset : offset + output.length })),
  };
}

if (!globalRuntime.__thunkRuntimeExit) {
  globalRuntime.__thunkRuntimeExit = true;
  process.once("exit", () => { for (const state of runtimes.values()) for (const proc of state.processes.values()) kill(proc); });
}
