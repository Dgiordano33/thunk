import "server-only";
import { query, type PermissionMode, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "./async-queue";
import { handleMessage } from "./event-bridge";
import { buildOptions } from "./options";
import type { AgentDriver, LiveSession } from "./session-registry";

/** Claude Agent SDK runtime: a streaming-input `query()` fed from an async queue. */
export async function createClaudeDriver(live: LiveSession, { resume }: { resume?: string }): Promise<AgentDriver> {
  const input = new AsyncQueue<SDKUserMessage>();
  const options = await buildOptions(live, { resume });
  const q = query({ prompt: input, options });

  return {
    async run() {
      for await (const msg of q) handleMessage(live, msg);
    },
    send(content, images = []) {
      input.push({ type: "user", message: { role: "user", content: images.length ? [
        ...(content ? [{ type: "text" as const, text: content }] : []),
        ...images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.url.split(",")[1] } })),
      ] : content }, parent_tool_use_id: null });
    },
    async interrupt() {
      await q.interrupt();
    },
    setModel: (model) => q.setModel(model),
    setPermissionMode: (mode) => q.setPermissionMode(mode as PermissionMode),
    close() {
      input.close();
      q.close();
    },
    get isClosed() {
      return input.isClosed;
    },
  };
}
