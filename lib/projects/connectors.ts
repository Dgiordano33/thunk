import "server-only";
import { createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { projectConfigDir, projectConnectorsFile } from "./paths";

const strings = z.record(z.string(), z.string());
const url = z.url().refine((value) => /^https?:\/\//i.test(value), "Use an HTTP(S) URL");
export const Connectors = z.strictObject({ mcpServers: z.record(
  z.string().regex(/^[a-zA-Z0-9_-]+$/).refine((name) => name !== "thunk", "thunk is reserved"),
  z.union([
    z.strictObject({ type: z.literal("stdio").optional(), command: z.string().trim().min(1), args: z.array(z.string()).optional(), env: strings.optional() }),
    z.strictObject({ type: z.enum(["http", "sse"]), url, headers: strings.optional() }),
  ]),
) });
export type ConnectorConfig = z.infer<typeof Connectors>;
const MASK = "••••••••";
const revision = (raw: string | null) => createHash("sha256").update(raw ?? "").digest("hex");

export async function readConnectors(key: string) {
  try {
    const raw = await readOptional(projectConnectorsFile(key));
    let parsed: unknown;
    try { parsed = raw === null ? { mcpServers: {} } : JSON.parse(raw); }
    catch { return { config: { mcpServers: {} } as ConnectorConfig, revision: revision(raw), error: "Invalid connector JSON. Correct and save it to enable connectors." }; }
    const result = Connectors.safeParse(parsed);
    if (!result.success) return { config: { mcpServers: {} } as ConnectorConfig, revision: revision(raw), error: "Invalid connector configuration. Correct and save it to enable connectors." };
    return { config: result.data, revision: revision(raw), error: null };
  } catch {
    // Never surface parser input: it may contain credentials.
    return { config: { mcpServers: {} } as ConnectorConfig, revision: null, error: "Cannot read connector configuration. Correct the file before saving." };
  }
}

export function maskConnectors(config: ConnectorConfig): ConnectorConfig {
  const masked = structuredClone(config);
  for (const server of Object.values(masked.mcpServers)) {
    const values = "command" in server ? server.env : server.headers;
    if (values) for (const key of Object.keys(values)) values[key] = MASK;
  }
  return masked;
}

export async function saveConnectors(key: string, input: ConnectorConfig, expectedRevision: string) {
  const file = projectConnectorsFile(key);
  return withFileLock(file, async () => {
    const raw = await readOptional(file);
    if (revision(raw) !== expectedRevision) throw new HttpError(409, "Connectors changed. Reload before saving.");
    const config = Connectors.parse(input);
    const previous = await readConnectors(key);
    for (const [name, server] of Object.entries(config.mcpServers)) {
      const old = previous.config.mcpServers[name];
      const values = "command" in server ? server.env : server.headers;
      const oldValues = old && ("command" in old ? old.env : old.headers);
      if (values) for (const field of Object.keys(values)) {
        if (values[field] !== MASK) continue;
        if (!oldValues || !(field in oldValues)) throw new HttpError(400, `Enter a value for ${name}.${field}`);
        values[field] = oldValues[field];
      }
    }
    await mkdir(projectConfigDir(key), { recursive: true, mode: 0o700 });
    await chmod(projectConfigDir(key), 0o700);
    await replaceFile(file, JSON.stringify(config, null, 2) + "\n", raw);
    await chmod(file, 0o600);
  });
}

/** Codex supports stdio and streamable HTTP; legacy SSE remains Claude-only. */
export function codexConnectors(config: ConnectorConfig) {
  return Object.fromEntries(Object.entries(config.mcpServers).flatMap(([name, server]) =>
    server.type === "sse" ? [] : [[name, "command" in server
      ? { command: server.command, args: server.args ?? [], env: server.env ?? {} }
      : { url: server.url, http_headers: server.headers ?? {} }]],
  ));
}
