"use client";

import { MessageSquareDashedIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { getCommentAnchors } from "@/lib/editor/markdown";
import { getEditor } from "@/lib/editor/registry";
import { useSession } from "@/lib/store/session-store";
import { Thread } from "./thread";

/** Comment threads for the active document, in document order. */
export function ThreadList() {
  const doc = useSession((s) => (s.activeDocumentId ? s.documents[s.activeDocumentId] : undefined));
  const activeCommentId = useSession((s) => s.activeCommentId);

  // Re-read live anchors whenever the document text changes.
  const anchors = useMemo(() => {
    const editor = doc ? getEditor(doc.id) : undefined;
    return editor ? getCommentAnchors(editor) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, doc?.currentMarkdown, doc?.comments]);

  useEffect(() => {
    if (activeCommentId)
      document.getElementById(`thread-${activeCommentId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeCommentId]);

  if (!doc) {
    return (
      <Empty text="Select a document to see its comments." />
    );
  }

  const readOnly = doc.status !== "draft";
  const sorted = [...doc.comments].sort(
    (a, b) => (anchors?.get(a.id)?.from ?? a.from ?? 0) - (anchors?.get(b.id)?.from ?? b.from ?? 0),
  );

  if (sorted.length === 0) {
    return (
      <Empty
        text={
          readOnly
            ? "No comments on this document."
            : "Select text in the document and choose Comment (⌘⌥M) to start a thread."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((c) => {
        const anchor = anchors?.get(c.id);
        return (
          <Thread
            key={c.id}
            comment={c}
            quote={anchor?.quote ?? c.quote}
            detached={Boolean(anchors) && !anchor}
            readOnly={readOnly}
          />
        );
      })}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-12 text-center text-sm">
      <MessageSquareDashedIcon className="size-5" />
      <p>{text}</p>
    </div>
  );
}
