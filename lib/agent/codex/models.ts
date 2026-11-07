import "server-only";
import type { ModelOption } from "../types";
import { CodexRpc } from "./rpc";

type CodexModel = { id: string; displayName: string; description: string; hidden: boolean; isDefault: boolean };

const TTL_MS = 10 * 60_000;

const g = globalThis as typeof globalThis & {
  __thunkCodexModels?: { at: number; models: Promise<ModelOption[]> };
};

/** Models the local Codex install offers (its picker list), cached for a few minutes. */
export function listCodexModels(): Promise<ModelOption[]> {
  const cached = g.__thunkCodexModels;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.models;
  const models = fetchModels();
  g.__thunkCodexModels = { at: Date.now(), models };
  // Don't cache failures (codex missing, signed out): retry on the next call.
  models.catch(() => {
    if (g.__thunkCodexModels?.models === models) g.__thunkCodexModels = undefined;
  });
  return models;
}

async function fetchModels(): Promise<ModelOption[]> {
  const rpc = new CodexRpc();
  const timeout = setTimeout(() => rpc.kill(), 15_000);
  try {
    await rpc.initialize();
    const out: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: CodexModel[]; nextCursor: string | null } = await rpc.request("model/list", { cursor });
      out.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return out
      .filter((m) => !m.hidden)
      .map((m) => ({ id: m.id, label: m.displayName, description: m.description, provider: "codex" as const }));
  } finally {
    clearTimeout(timeout);
    rpc.kill();
  }
}
