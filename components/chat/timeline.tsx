"use client";

import { CivPanel } from "@/components/world/civ-panel";
import { EmptyMark } from "@/components/space/orbit-mark";

import { AlertTriangleIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { AskQuestionForm } from "@/components/approvals/ask-question-form";
import { PermissionCard } from "@/components/approvals/permission-card";
import { DocumentCard } from "@/components/canvas/document-card";
import { useSession } from "@/lib/store/session-store";
import { AssistantTurn } from "./assistant-turn";
import { UserMessage } from "./user-message";

function RequestItem({ requestId }: { requestId: string }) {
  const req = useSession((s) => s.requests[requestId]);
  if (!req) return null;
  if (req.kind === "permission") return <PermissionCard requestId={requestId} />;
  if (req.kind === "question") return <AskQuestionForm requestId={requestId} />;
  return <DocumentCard documentId={req.documentId} />;
}

export function Timeline() {
  const live = useSession((s) => s.meta?.live);
  const items = useSession((s) => s.items);

  return (
    <Conversation initial="instant" resize="smooth" className="min-h-0">
      <ConversationContent className="mx-auto w-full max-w-3xl gap-6 [&>div]:[content-visibility:auto] [&>div]:[contain-intrinsic-size:auto_200px] px-4 md:px-6 pt-4 md:pt-8 pb-16">
        {items.length === 0 ? (
          <CivPanel parchment className="mx-auto max-w-md" bodyClassName="p-5 text-center">
            <EmptyMark name="scroll" className="mx-auto mb-2" pixelClassName="mx-auto mb-3 size-8" />
            <h2 className="pixel text-lg">Start the conversation</h2>
            <p className="text-muted-foreground mt-2 text-sm">{live ? "Replies arrive as documents you can edit and comment on." : "Send your first message to resume this session. Replies arrive as documents you can edit and comment on."}</p>
          </CivPanel>
        ) : (
          items.map((item) => {
            switch (item.kind) {
              case "user":
                return <UserMessage key={item.id} item={item} />;
              case "turn":
                return <AssistantTurn key={item.id} turnId={item.id} />;
              case "request":
                return <RequestItem key={item.id} requestId={item.id} />;
              case "error":
                return (
                  <div
                    key={item.id}
                    className="border-destructive/40 bg-destructive/5 text-destructive flex gap-2 rounded-lg border p-3 text-sm"
                  >
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                    <pre className="min-w-0 font-sans whitespace-pre-wrap [overflow-wrap:anywhere]">{item.message}</pre>
                  </div>
                );
            }
          })
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
