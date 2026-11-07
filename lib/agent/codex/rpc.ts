import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { env } from "@/lib/env";

export type RpcId = number | string;
type Message = { id?: RpcId; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message: string } };

export type CodexRpcOptions = {
  cwd?: string;
  onNotification?: (method: string, params: unknown) => void;
  /** Server → client requests (approvals etc). Resolve with the JSON-RPC result. */
  onRequest?: (method: string, params: unknown, id: RpcId) => Promise<unknown>;
  onStderr?: (data: string) => void;
};

export class RpcError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

const CLIENT_INFO = { name: "thunk", title: "Thunk", version: "0.1.0" };

/**
 * JSON-RPC (newline-delimited JSON over stdio) client for `codex app-server`.
 * One process per client; `exited` settles when it goes away.
 */
export class CodexRpc {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private waiting = new Map<RpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private killed = false;
  readonly exited: Promise<{ code: number | null; killed: boolean }>;

  constructor(private opts: CodexRpcOptions = {}) {
    this.proc = spawn(env.CODEX_BIN ?? "codex", ["app-server"], {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exited = new Promise((resolve) => {
      this.proc.once("exit", (code) => resolve({ code, killed: this.killed }));
      this.proc.once("error", (err) => {
        opts.onStderr?.(`${err.message}\n`);
        resolve({ code: -1, killed: this.killed });
      });
    });
    void this.exited.then(({ code }) => {
      for (const w of this.waiting.values()) w.reject(new RpcError(`codex app-server exited (code ${code})`));
      this.waiting.clear();
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (d: string) => opts.onStderr?.(d));
    readline.createInterface({ input: this.proc.stdout }).on("line", (line) => this.onLine(line));
  }

  get isAlive() {
    return !this.killed && this.proc.exitCode === null && this.proc.signalCode === null;
  }

  /** Handshake. Must be the first request. */
  async initialize() {
    await this.request("initialize", {
      clientInfo: CLIENT_INFO,
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.notify("initialized");
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      if (!this.isAlive) return reject(new RpcError("codex app-server is not running"));
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown) {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  kill() {
    if (this.killed) return;
    this.killed = true;
    this.proc.stdin.end();
    this.proc.kill("SIGTERM");
  }

  private write(msg: Message) {
    if (!this.isAlive) return;
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private onLine(line: string) {
    let msg: Message;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method && msg.id != null) {
      const id = msg.id;
      const handler = this.opts.onRequest ?? (() => Promise.reject(new RpcError(`Unsupported request ${msg.method}`)));
      handler(msg.method, msg.params, id).then(
        (result) => this.write({ id, result }),
        (err: Error) => this.write({ id, error: { code: -32601, message: err.message } }),
      );
    } else if (msg.method) {
      this.opts.onNotification?.(msg.method, msg.params);
    } else if (msg.id != null) {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.error) w.reject(new RpcError(msg.error.message, msg.error.code));
      else w.resolve(msg.result);
    }
  }
}
