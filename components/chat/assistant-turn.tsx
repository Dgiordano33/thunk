"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { DocumentCard } from "@/components/canvas/document-card";
import { AskQuestionForm } from "@/components/approvals/ask-question-form";
import { PermissionCard } from "@/components/approvals/permission-card";
import { useSession } from "@/lib/store/session-store";
import { ToolCallView } from "./tool-call";

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

/**
 * An assistant turn: interim narration and tool calls render as a compact
 * trace; the turn's final prose becomes an editable canvas document.
 */
export function AssistantTurn({ turnId }: { turnId: string }) {
  const turn = useSession((s) => s.turns[turnId]);
  if (!turn) return null;
  const streaming = turn.status === "streaming";

  // The trailing text part is the document once the turn completes.
  const lastText = turn.parts.length - 1;
  const docTakesLast = Boolean(turn.documentId) && turn.parts[lastText]?.kind === "text";
  const trace = docTakesLast ? turn.parts.slice(0, lastText) : turn.parts;

  return (
    <div className="flex flex-col gap-3">
      {turn.thinking && (
        <Reasoning isStreaming={streaming && turn.parts.length === 0} className="mb-0">
          <ReasoningTrigger />
          <ReasoningContent>{turn.thinking}</ReasoningContent>
        </Reasoning>
      )}

      {trace.map((part, i) =>
        part.kind === "tool" ? (
          <ToolPart key={part.toolUseId} toolUseId={part.toolUseId} />
        ) : (
          <MessageResponse
            key={i}
            isAnimating={streaming && i === trace.length - 1}
            className={i === trace.length - 1 && streaming ? "text-[15px] leading-7" : "text-muted-foreground text-sm"}
          >
            {part.text}
          </MessageResponse>
        ),
      )}

      {streaming && trace.length === 0 && !turn.thinking && (
        <Shimmer className="text-sm">Thinking…</Shimmer>
      )}

      {turn.documentId && <DocumentCard documentId={turn.documentId} />}
    </div>
  );
}
