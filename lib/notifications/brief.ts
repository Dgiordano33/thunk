import "server-only";
import { providerOf } from "@/lib/agent/types";
import { env } from "@/lib/env";
import { BRIEF_SYSTEM, briefPrompt, cleanBrief } from "./brief-prompt";
import type { NotificationContext } from "./context";
import type { Notification } from "./types";

// A model-written brief for an inbox item. The digest in context.ts is always there; this sits on top of it and may be absent.

export type BriefRunner = (prompt: string, signal: AbortSignal) => Promise<string>;

const TIMEOUT_MS = 45_000;
/** After a failure (signed out, offline, rate limited) wait before spending another attempt on the same item. */
const RETRY_MS = 60_000;
const MAX_ENTRIES = 300;
const g = globalThis as typeof globalThis & { __thunkBriefs?: Map<string, { brief: string | null; at: number }>; __thunkBriefRuns?: Map<string, Promise<string | null>> };
const cache = (g.__thunkBriefs ??= new Map());
const running = (g.__thunkBriefRuns ??= new Map());

/** A tool-less, settings-less one-shot Agent SDK query, as the Vault's reader uses. Works with an API key or the local `claude` login. */
export const runWithClaude: BriefRunner = async (prompt, signal) => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abortController = new AbortController();
  signal.addEventListener("abort", () => abortController.abort(), { once: true });
  const q = query({
    prompt,
    options: {
      // Briefs are a Claude call even when sessions default to Codex.
      model: providerOf(env.DEFAULT_MODEL) === "claude" ? env.DEFAULT_MODEL : "claude-opus-5-5",
      systemPrompt: BRIEF_SYSTEM,
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      effort: "low",
      abortController,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "thunk/0.1.0" },
    },
  });
  let out: string | undefined;
  for await (const msg of q) {
    if (msg.type !== "result") continue;
    if (msg.subtype !== "success") throw new Error(`Brief failed (${msg.subtype}).`);
    out = msg.result;
  }
  if (out === undefined) throw new Error("Claude returned no result.");
  return out;
};
/** Browser tests run without an agent; they get a fixed sentence so the panel's summary row can be checked. */
const runForTests: BriefRunner = async () => "The agent paused here and is waiting on you.";
const defaultRunner = () => process.env.NEXT_PUBLIC_THUNK_E2E === "1" ? runForTests : runWithClaude;

/**
 * The brief for a notification in its current state, written once per `ctx.briefKey` and shared by concurrent
 * callers. Null when there is nothing to summarize or the model could not be reached; never throws.
 */
export async function briefFor(n: Notification, ctx: NotificationContext, run: BriefRunner = defaultRunner()): Promise<string | null> {
  const key = ctx.briefKey;
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && (hit.brief !== null || Date.now() - hit.at < RETRY_MS)) return hit.brief;
  const active = running.get(key);
  if (active) return active;
  const task = (async () => {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let brief: string | null = null;
    try {
      brief = cleanBrief(await Promise.race([
        run(briefPrompt(n, ctx), timeout),
        new Promise<never>((_, reject) => timeout.addEventListener("abort", () => reject(new Error("Brief timed out.")), { once: true })),
      ]));
    } catch (err) { console.error("[thunk] inbox brief failed", n.id, (err as Error).message); }
    cache.delete(key);
    cache.set(key, { brief, at: Date.now() });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    return brief;
  })().finally(() => running.delete(key));
  running.set(key, task);
  return task;
}
