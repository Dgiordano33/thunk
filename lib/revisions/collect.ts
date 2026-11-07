"use client";

import { docToMarkdown, getCommentAnchors, normalizeMarkdown } from "@/lib/editor/markdown";
import { getEditor } from "@/lib/editor/registry";
import type { DocState } from "@/lib/store/session-store";
import type { RevisionComment } from "./build-payload";

export function baselineOf(doc: DocState) {
  return doc.baselineMarkdown ?? normalizeMarkdown(doc.originalMarkdown);
}

/** Snapshot a document for sending: live editor markdown + comment quotes re-read from their marks. */
export function collectRevision(doc: DocState) {
  const editor = getEditor(doc.id);
  const editedMarkdown = editor ? docToMarkdown(editor) : doc.currentMarkdown;
  const anchors = editor ? getCommentAnchors(editor) : new Map();
  const comments: RevisionComment[] = doc.comments
    .filter((c) => c.body.trim())
    .map((c) => {
      const anchor = anchors.get(c.id);
      return {
        id: c.id,
        status: c.status,
        kind: c.kind,
        quote: anchor?.quote ?? c.quote,
        context: anchor?.blockContext ?? "",
        body: c.body.trim(),
        replies: c.replies.filter((r) => r.body.trim()).map((r) => ({ body: r.body.trim() })),
        detached: editor ? !anchor : undefined,
      };
    });
  return { baselineMarkdown: baselineOf(doc), editedMarkdown, comments };
}
