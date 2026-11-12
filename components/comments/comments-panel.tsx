"use client";

import { XIcon } from "lucide-react";
import { ThreadList } from "@/components/comments/thread-list";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/lib/store/session-store";
import { useUi } from "@/lib/store/ui-store";

export function CommentsPanel() {
  const doc = useSession((s) => (s.activeDocumentId ? s.documents[s.activeDocumentId] : undefined));
  const setOpen = useUi((s) => s.setCommentsOpen);
  const openCount = doc?.comments.filter((c) => c.status === "open").length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="pixel text-sm">Comments</h2>
        {openCount > 0 && <span className="text-muted-foreground text-xs tabular-nums">{openCount}</span>}
        {doc && (
          <span className="text-muted-foreground truncate text-xs">
            · {doc.kind === "plan" ? "Plan" : "Response"} v{doc.version}
            {doc.status !== "draft" && " · read-only"}
          </span>
        )}
        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Close comments" onClick={() => setOpen(false)}>
          <XIcon />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <ThreadList />
        </div>
      </ScrollArea>
    </div>
  );
}
