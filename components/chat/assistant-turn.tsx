"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { DocumentCard } from "@/components/canvas/document-card";
import { AskQuestionForm } from "@/components/approvals/ask-question-form";
import { PermissionCard } from "@/components/approvals/permission-card";
import { useSession } from "@/lib/store/session-store";
import { ToolCallView, ToolGroup } from "./tool-call";
import type { TurnPart } from "@/lib/store/session-store";

/** A tool call, plus the approval / question / plan it is waiting on, rendered in place. */
function ToolPart({ toolUseId }: { toolUseId: string }) {
  const request = useSession((s) => {
    const id = s.requestByToolUse[toolUseId];
    return id ? s.requests[id] : undefined;
  });
  if (request?.kind === "plan") return <DocumentCard documentId={request.documentId} />;
  if (request?.kind === "question") return <AskQuestionForm requestId={request.id} />;
  return (
    <>
      <ToolCallView toolUseId={toolUseId} />
      {request?.kind === "permission" && request.status === "pending" && <PermissionCard requestId={request.id} />}
    </>
  );
}

type Segment =
  | { kind: "text"; text: string; index: number }
  | { kind: "tool"; toolUseId: string }
  | { kind: "tools"; toolUseIds: string[] };

/**
 * Fold consecutive plain tool calls into one group. Calls tied to an approval,
 * question or plan stay standalone so they are never hidden behind a fold.
 */
function segment(parts: TurnPart[], requestByToolUse: Record<string, string>): Segment[] {
  const out: Segment[] = [];
  parts.forEach((part, index) => {
    if (part.kind === "text") return void out.push({ kind: "text", text: part.text, index });
    if (requestByToolUse[part.toolUseId]) return void out.push({ kind: "tool", toolUseId: part.toolUseId });
    const last = out[out.length - 1];
    if (last?.kind === "tools") last.toolUseIds.push(part.toolUseId);
    else out.push({ kind: "tools", toolUseIds: [part.toolUseId] });
  });
  return out;
}

/**
 * An assistant turn: interim narration and tool calls render as a compact
 * trace; the turn's final prose becomes an editable canvas document.
 */
export function AssistantTurn({ turnId }: { turnId: string }) {
  const turn = useSession((s) => s.turns[turnId]);
  const requestByToolUse = useSession((s) => s.requestByToolUse);
  if (!turn) return null;
  const streaming = turn.status === "streaming";

  // The trailing text part is the document once the turn completes.
  const lastText = turn.parts.length - 1;
  const docTakesLast = Boolean(turn.documentId) && turn.parts[lastText]?.kind === "text";
  const trace = docTakesLast ? turn.parts.slice(0, lastText) : turn.parts;
  const segments = segment(trace, requestByToolUse);

  return (
    <div className="flex flex-col gap-3">
      {turn.thinking && (
        <Reasoning isStreaming={streaming && turn.parts.length === 0} className="mb-0">
          <ReasoningTrigger />
          <ReasoningContent>{turn.thinking}</ReasoningContent>
        </Reasoning>
      )}

      {segments.map((seg, i) => {
        if (seg.kind === "tool") return <ToolPart key={seg.toolUseId} toolUseId={seg.toolUseId} />;
        if (seg.kind === "tools")
          return <ToolGroup key={seg.toolUseIds[0]} toolUseIds={seg.toolUseIds} live={streaming && i === segments.length - 1} />;
        const isTail = seg.index === trace.length - 1;
        return (
          <MessageResponse
            key={seg.index}
            isAnimating={streaming && isTail}
            className={isTail && streaming ? "text-[15px] leading-7" : "text-muted-foreground text-sm"}
          >
            {seg.text}
          </MessageResponse>
        );
      })}

      {streaming && trace.length === 0 && !turn.thinking && (
        <Shimmer className="text-sm">Thinking…</Shimmer>
      )}

      {turn.documentId && <DocumentCard documentId={turn.documentId} />}
    </div>
  );
}
