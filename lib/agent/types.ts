import type { PromptImage } from "@/lib/prompts/schema";
import type { SessionOrigin } from "@/lib/routines/types";
// Shared between server and client. Keep free of server-only imports.

export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
export type HarnessPermissionMode = (typeof PERMISSION_MODES)[number];

export type AgentProvider = "claude" | "codex";

export const PROVIDER_LABELS: Record<AgentProvider, string> = { claude: "Claude", codex: "Codex" };

export type ModelOption = { id: string; label: string; provider: AgentProvider; description?: string };

export const CLAUDE_MODELS: ModelOption[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5", provider: "claude" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", provider: "claude" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", provider: "claude" },
  { id: "claude-fable-5-1", label: "Fable 5.1", provider: "claude" },
];

/** Claude ids and aliases go to the Agent SDK; anything else is a Codex model (list comes from `codex app-server`). */
export function providerOf(model: string | null | undefined): AgentProvider {
  return !model || /^(claude|opus|sonnet|haiku|fable)\b/i.test(model) ? "claude" : "codex";
}

/** Plan mode is a Claude Agent SDK feature; Codex sessions only get modes that map onto its approval policies. */
export function permissionModesFor(provider: AgentProvider): readonly HarnessPermissionMode[] {
  return provider === "codex" ? PERMISSION_MODES.filter((m) => m !== "plan") : PERMISSION_MODES;
}

export type SessionState = "starting" | "idle" | "running" | "awaiting" | "closed" | "error";

export type Question = {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string; preview?: string }[];
};

export type PermissionSuggestion = Record<string, unknown>;

export type HarnessEventBody =
  | {
      type: "init";
      sdkSessionId: string;
      model: string;
      cwd: string;
      permissionMode: string;
      tools: string[];
    }
  | {
      type: "user_message";
      messageId: string;
      content: string;
      kind: "prompt" | "revision";
      images?: PromptImage[];
      queued?: boolean;
      /** For revisions: the document the user revised. */
      documentId?: string;
      stat?: { edits: number; comments: number };
    }
  | { type: "message_dequeued"; messageId: string }
  | { type: "turn_start"; turnId: string }
  | { type: "text_delta"; turnId: string; text: string }
  | { type: "thinking_delta"; turnId: string; text: string }
  | { type: "tool_use"; turnId: string; toolUseId: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | {
      type: "permission_request";
      requestId: string;
      toolUseId: string;
      toolName: string;
      input: unknown;
      title?: string;
      description?: string;
      decisionReason?: string;
      suggestions?: PermissionSuggestion[];
    }
  | { type: "permission_resolved"; requestId: string; decision: "allow" | "deny" | "cancelled" }
  | { type: "ask_question"; requestId: string; toolUseId: string; questions: Question[] }
  | {
      type: "question_resolved";
      requestId: string;
      answers: Record<string, string> | null;
    }
  | {
      type: "plan_proposed";
      requestId: string;
      toolUseId: string;
      documentId: string;
      plan: string;
      parentDocumentId?: string;
      version: number;
    }
  | {
      type: "plan_resolved";
      requestId: string;
      decision: "approve" | "changes" | "cancelled";
    }
  | {
      type: "turn_complete";
      turnId: string;
      /** Null when the turn produced no trailing prose (e.g. ended on a tool call). */
      documentId: string | null;
      markdown: string;
      parentDocumentId?: string;
      version: number;
    }
  | {
      type: "result";
      subtype: string;
      isError: boolean;
      costUsd: number;
      numTurns: number;
      durationMs: number;
    }
  | {
      type: "status";
      state: SessionState;
      permissionMode?: string;
      model?: string;
      /** Set when a live session was (re)created from a persisted one. */
      resumed?: boolean;
    }
  | { type: "error"; message: string };

export type HarnessEvent = HarnessEventBody & { seq: number; sessionId: string; ts: number };

export type HarnessEventType = HarnessEvent["type"];

export type SessionMeta = {
  id: string;
  projectId: string;
  workspaceId: string;
  cwd: string;
  model: string;
  permissionMode: string;
  sdkSessionId?: string | null;
  title?: string | null;
  status: SessionState;
  createdAt: string;
  live: boolean;
  /** What started the session when it wasn't a person, e.g. a routine. */
  origin?: SessionOrigin | null;
};
