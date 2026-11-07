import "server-only";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { emit, releaseSession, setState, type LiveSession, type TurnState } from "./session-registry";

const MAX_TOOL_RESULT_CHARS = 20_000;

/** Pump SDK messages into harness events until the query ends. */
export async function runSession(live: LiveSession) {
  try {
    for await (const msg of live.query) handleMessage(live, msg);
    if (live.meta.status !== "closed") setState(live, "closed");
  } catch (err) {
    const tail = live.stderrTail.slice(-5).join("").trim();
    const message = err instanceof Error ? err.message : String(err);
    emit(live, { type: "error", message: tail ? `${message}\n${tail}` : message });
    setState(live, "error");
  } finally {
    // Stays registered (history, status) until resumeSession replaces it.
    releaseSession(live);
  }
}

function handleMessage(live: LiveSession, msg: SDKMessage) {
  switch (msg.type) {
    case "system": {
      if (msg.subtype !== "init") return;
      const changed =
        live.meta.sdkSessionId !== msg.session_id ||
        live.meta.model !== msg.model ||
        live.meta.permissionMode !== msg.permissionMode ||
        !live.events.some((e) => e.type === "init");
      live.meta.sdkSessionId = msg.session_id;
      live.meta.model = msg.model;
      live.meta.permissionMode = msg.permissionMode;
      if (changed) {
        emit(live, {
          type: "init",
          sdkSessionId: msg.session_id,
          model: msg.model,
          cwd: msg.cwd,
          permissionMode: msg.permissionMode,
          tools: msg.tools,
        });
      }
      return;
    }

    case "stream_event": {
      if (msg.parent_tool_use_id) return;
      const ev = msg.event;
      if (ev.type === "message_start") {
        const turn = ensureTurn(live, true);
        turn.streamedMessageIds.add(ev.message.id);
      } else if (ev.type === "content_block_start" && ev.content_block.type === "text") {
        const turn = ensureTurn(live);
        if (turn.segmentText && !turn.lastPartWasTool) appendText(live, turn, "\n\n");
      } else if (ev.type === "content_block_delta") {
        const turn = ensureTurn(live);
        if (ev.delta.type === "text_delta") appendText(live, turn, ev.delta.text);
        else if (ev.delta.type === "thinking_delta")
          emit(live, { type: "thinking_delta", turnId: turn.id, text: ev.delta.thinking });
      }
      return;
    }

    case "assistant": {
      if (msg.parent_tool_use_id) return;
      const streamed = live.turn?.streamedMessageIds.has(msg.message.id) ?? false;
      const turn = ensureTurn(live, !streamed);
      for (const block of msg.message.content) {
        if (block.type === "text" && !streamed) {
          if (turn.segmentText && !turn.lastPartWasTool) appendText(live, turn, "\n\n");
          appendText(live, turn, block.text);
        } else if (block.type === "tool_use") {
          turn.lastPartWasTool = true;
          emit(live, {
            type: "tool_use",
            turnId: turn.id,
            toolUseId: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
      return;
    }

    case "user": {
      if (msg.parent_tool_use_id) return;
      const content = msg.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        emit(live, {
          type: "tool_result",
          toolUseId: block.tool_use_id,
          content: stringifyToolResult(block.content),
          isError: Boolean(block.is_error),
        });
      }
      return;
    }

    case "result": {
      if (live.turn) finishTurn(live, live.turn, true);
      emit(live, {
        type: "result",
        subtype: msg.subtype,
        isError: msg.is_error,
        costUsd: msg.total_cost_usd,
        numTurns: msg.num_turns,
        durationMs: msg.duration_ms,
      });
      if (live.pending.size === 0) setState(live, "idle");
      return;
    }
  }
}

/**
 * Get the current turn, starting one if needed. A queued follow-up marks the turn as `split`;
 * only honor that at the start of a new API message so an in-flight response isn't cut in two.
 */
function ensureTurn(live: LiveSession, newMessage = false): TurnState {
  if (newMessage && live.turn?.split) finishTurn(live, live.turn, false);
  if (live.turn) return live.turn;
  const turn: TurnState = {
    id: crypto.randomUUID(),
    segmentText: "",
    lastPartWasTool: false,
    split: false,
    streamedMessageIds: new Set(),
  };
  live.turn = turn;
  emit(live, { type: "turn_start", turnId: turn.id });
  if (live.meta.status !== "awaiting") setState(live, "running");
  return turn;
}

function appendText(live: LiveSession, turn: TurnState, text: string) {
  if (!text) return;
  if (turn.lastPartWasTool) {
    turn.segmentText = "";
    turn.lastPartWasTool = false;
  }
  turn.segmentText += text;
  emit(live, { type: "text_delta", turnId: turn.id, text });
}

function finishTurn(live: LiveSession, turn: TurnState, final: boolean) {
  live.turn = null;
  const markdown = turn.lastPartWasTool ? "" : turn.segmentText.trim();
  const documentId = final && markdown ? crypto.randomUUID() : null;
  const parent = documentId ? live.pendingRevision : null;
  if (documentId) live.pendingRevision = null;
  emit(live, {
    type: "turn_complete",
    turnId: turn.id,
    documentId,
    markdown,
    parentDocumentId: parent?.documentId,
    version: parent ? parent.version + 1 : 1,
  });
}

function stringifyToolResult(content: unknown): string {
  let text: string;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content))
    text = content
      .map((c) =>
        c && typeof c === "object" && "type" in c && c.type === "text" && "text" in c
          ? String(c.text)
          : `[${(c as { type?: string })?.type ?? "content"}]`,
      )
      .join("\n");
  else text = content == null ? "" : JSON.stringify(content);
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n… [truncated ${text.length - MAX_TOOL_RESULT_CHARS} chars]`
    : text;
}
