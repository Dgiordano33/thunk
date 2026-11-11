"use client";

import { AlertTriangleIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
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
  const items = useSession((s) => s.items);

  return (
    <Conversation initial="instant" resize="smooth" className="min-h-0">
      <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-6 pt-8 pb-16">
        {items.length === 0 ? (
          <ConversationEmptyState
            title="Start the conversation"
            description="Claude's replies arrive as documents you can edit and comment on."
          />
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
                    <pre className="font-sans whitespace-pre-wrap">{item.message}</pre>
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
