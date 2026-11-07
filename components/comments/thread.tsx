"use client";

import { CheckIcon, HelpCircleIcon, MoreHorizontalIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { removeCommentMark } from "@/components/canvas/document-editor";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DocComment } from "@/lib/documents/types";
import { getEditor } from "@/lib/editor/registry";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";

export function Thread({
  comment,
  quote,
  detached,
  readOnly,
}: {
  comment: DocComment;
  quote: string;
  detached: boolean;
  readOnly: boolean;
}) {
  const active = useSession((s) => s.activeCommentId === comment.id);
  const composing = useSession((s) => s.composingCommentId === comment.id);
  const { setActiveComment, updateComment, deleteComment, setComposing } = useSession.getState();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const resolved = comment.status === "resolved";

  const remove = () => {
    removeCommentMark(getEditor(comment.documentId), comment.id);
    deleteComment(comment.documentId, comment.id);
  };

  const focusMark = () => {
    setActiveComment(comment.id, comment.documentId);
    document
      .querySelector(`[data-doc="${comment.documentId}"] [data-comment-id="${comment.id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const drafting = composing || (!comment.body && !readOnly);

  return (
    <div
      id={`thread-${comment.id}`}
      onClick={focusMark}
      className={cn(
        "bg-card cursor-pointer rounded-lg border p-3 text-sm transition-[border-color,box-shadow,opacity]",
        active && "border-amber-400 shadow-sm",
        resolved && !active && "opacity-60",
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <blockquote
          className={cn(
            "text-muted-foreground line-clamp-2 flex-1 border-l-2 pl-2 text-xs italic",
            detached ? "border-muted-foreground/30 line-through" : "border-amber-400",
          )}
          title={detached ? "The commented text was deleted" : undefined}
        >
          {quote || "…"}
        </blockquote>
        {comment.kind === "question" && <HelpCircleIcon className="size-3.5 shrink-0 text-sky-600" />}
        {!readOnly && !drafting && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button size="icon-xs" variant="ghost" className="-mt-1 -mr-1" aria-label="Thread actions">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  updateComment(comment.documentId, comment.id, { status: resolved ? "open" : "resolved" })
                }
              >
                {resolved ? <RotateCcwIcon /> : <CheckIcon />}
                {resolved ? "Reopen" : "Resolve"}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {drafting || editing ? (
        <Composer
          autoFocus
          initial={comment.body}
          placeholder={comment.kind === "question" ? "Ask a question about this…" : "What should change?"}
          submitLabel={editing ? "Save" : comment.kind === "question" ? "Ask" : "Comment"}
          onSubmit={(body) => {
            updateComment(comment.documentId, comment.id, { body });
            setComposing(null);
            setEditing(false);
          }}
          onCancel={() => {
            if (editing) setEditing(false);
            else remove();
          }}
        />
      ) : (
        <>
          <p className="leading-relaxed whitespace-pre-wrap">{comment.body}</p>
          <p className="text-muted-foreground mt-1 text-[11px]">
            {relativeTime(comment.createdAt)}
            {resolved && " · resolved"}
            {detached && " · text deleted"}
          </p>
        </>
      )}

      {comment.replies.map((r) => (
        <div key={r.id} className="mt-2 border-t pt-2">
          <p className="leading-relaxed whitespace-pre-wrap">{r.body}</p>
          <p className="text-muted-foreground mt-1 text-[11px]">{relativeTime(r.createdAt)}</p>
        </div>
      ))}

      {!readOnly && !drafting && !editing && active && (
        <div className="mt-2 border-t pt-2">
          {replying ? (
            <Composer
              autoFocus
              placeholder="Reply…"
              submitLabel="Reply"
              onSubmit={(body) => {
                updateComment(comment.documentId, comment.id, {
                  replies: [...comment.replies, { id: crypto.randomUUID(), body, createdAt: new Date().toISOString() }],
                });
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          ) : (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setReplying(true);
              }}
            >
              Reply
            </button>
          )}
        </div>
      )}
    </div>
  );
}
