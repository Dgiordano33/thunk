"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import type { CommentKind } from "@/lib/documents/types";
import { editorExtensions } from "@/lib/editor/extensions";
import { docToMarkdown } from "@/lib/editor/markdown";
import { registerEditor } from "@/lib/editor/registry";
import { useSession } from "@/lib/store/session-store";
import { CommentBubbleMenu } from "./comment-bubble-menu";

const SYNC_MS = 250;

/**
 * One TipTap instance per canvas document. Content is loaded once (persisted
 * JSON with comment marks if we have it, else the model's markdown); after
 * that the editor owns the text and pushes debounced snapshots to the store.
 */
export function DocumentEditor({
  documentId,
  editable,
  onSubmitShortcut,
}: {
  documentId: string;
  editable: boolean;
  onSubmitShortcut?: () => void;
}) {
  const initial = useMemo(() => useSession.getState().documents[documentId], [documentId]);
  const comments = useSession((s) => s.documents[documentId]?.comments);
  const activeCommentId = useSession((s) => s.activeCommentId);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const submitRef = useRef(onSubmitShortcut);
  useEffect(() => {
    submitRef.current = onSubmitShortcut;
  }, [onSubmitShortcut]);

  const extensions = useMemo(() => editorExtensions({ placeholder: "Empty document" }), []);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      editable,
      content: initial?.contentJson ?? initial?.currentMarkdown ?? "",
      contentType: initial?.contentJson ? "json" : "markdown",
      editorProps: {
        attributes: { class: "focus:outline-none", spellcheck: "true" },
        handleClick: (view, pos) => {
          const marks = view.state.doc.resolve(pos).marks();
          const mark = marks.find((m) => m.type.name === "comment");
          if (mark) useSession.getState().setActiveComment(mark.attrs.commentId, documentId);
          return false;
        },
        handleKeyDown: (_view, event) => {
          const mod = event.metaKey || event.ctrlKey;
          if (mod && event.altKey && event.code === "KeyM") {
            event.preventDefault();
            if (editorRef.current) createComment(editorRef.current, documentId, "change");
            return true;
          }
          if (mod && event.key === "Enter" && submitRef.current) {
            event.preventDefault();
            submitRef.current();
            return true;
          }
          return false;
        },
      },
      onCreate: ({ editor }) => {
        const doc = useSession.getState().documents[documentId];
        // Fresh document: its round-tripped markdown is the baseline every diff runs against.
        if (doc && !doc.baselineMarkdown && !doc.contentJson) {
          useSession.getState().updateDocument(documentId, {
            baselineMarkdown: docToMarkdown(editor),
            currentMarkdown: docToMarkdown(editor),
          });
        }
      },
      onUpdate: ({ editor }) => {
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => {
          useSession.getState().updateDocument(documentId, {
            currentMarkdown: docToMarkdown(editor),
            contentJson: editor.getJSON(),
          });
        }, SYNC_MS);
      },
    },
    [documentId],
  );

  useEffect(() => {
    editorRef.current = editor;
    if (!editor) return;
    return registerEditor(documentId, editor);
  }, [editor, documentId]);

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(
    () => () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    },
    [],
  );

  // Active/resolved thread styling without mutating marks.
  const css = useMemo(() => {
    const scope = `[data-doc="${documentId}"]`;
    const rules: string[] = [];
    for (const c of comments ?? []) {
      const sel = `${scope} .comment-mark[data-comment-id="${c.id}"]`;
      if (c.status === "resolved")
        rules.push(`${sel}{background:transparent;border-bottom:1px dashed var(--muted-foreground)}`);
      if (c.id === activeCommentId) rules.push(`${sel}{background:oklch(0.86 0.14 85 / 0.75)}`);
    }
    return rules.join("\n");
  }, [comments, activeCommentId, documentId]);

  return (
    <div data-doc={documentId} className="doc-prose">
      {css && <style>{css}</style>}
      {editor && editable && (
        <CommentBubbleMenu editor={editor} onComment={(kind) => createComment(editor, documentId, kind)} />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function createComment(editor: Editor, documentId: string, kind: CommentKind) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  const id = crypto.randomUUID();
  const quote = editor.state.doc.textBetween(from, to, " ");
  editor.chain().focus().setComment(id).setTextSelection(to).run();
  useSession.getState().addComment({
    id,
    documentId,
    kind,
    status: "open",
    body: "",
    quote,
    from,
    to,
    createdAt: new Date().toISOString(),
    replies: [],
  });
}

export function removeCommentMark(editor: Editor | undefined, commentId: string) {
  editor?.chain().unsetComment(commentId).run();
}
