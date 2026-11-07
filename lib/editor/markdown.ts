import type { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { schemaExtensions } from "./extensions";

let manager: MarkdownManager | null = null;
function getManager() {
  manager ??= new MarkdownManager({ extensions: schemaExtensions(), indentation: { style: "space", size: 2 } });
  return manager;
}

/** Collapse serializer noise (blank-line runs, trailing space) so diffs show only real edits. */
export function tidyMarkdown(md: string) {
  return md
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

/**
 * The model's markdown after a parse → serialize round trip through the same
 * schema the editor uses. Diffing against this (not the raw text) means an
 * untouched document shows zero edits even where TipTap normalizes formatting.
 */
export function normalizeMarkdown(md: string) {
  const m = getManager();
  return tidyMarkdown(m.serialize(m.parse(md)));
}

export function docToMarkdown(editor: Editor) {
  return tidyMarkdown(editor.getMarkdown());
}

export type CommentAnchor = { commentId: string; from: number; to: number; quote: string; blockContext: string };

/** Current position + text of every comment mark, read at send time. */
export function getCommentAnchors(editor: Editor): Map<string, CommentAnchor> {
  const { doc } = editor.state;
  const ranges = new Map<string, { from: number; to: number }>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== "comment") continue;
      const id = mark.attrs.commentId as string;
      const r = ranges.get(id);
      const end = pos + node.nodeSize;
      if (r) {
        r.from = Math.min(r.from, pos);
        r.to = Math.max(r.to, end);
      } else ranges.set(id, { from: pos, to: end });
    }
  });

  const out = new Map<string, CommentAnchor>();
  for (const [commentId, { from, to }] of ranges) {
    out.set(commentId, {
      commentId,
      from,
      to,
      quote: doc.textBetween(from, to, " "),
      blockContext: blockContext(editor, from),
    });
  }
  return out;
}

const BLOCK_LABELS: Record<string, string> = {
  paragraph: "paragraph",
  bulletList: "list",
  orderedList: "list",
  codeBlock: "code block",
  blockquote: "quote",
  table: "table",
  heading: "heading",
};

/** e.g. "## Setup › paragraph 2" — the nearest heading above plus the block's ordinal under it. */
function blockContext(editor: Editor, pos: number) {
  const { doc } = editor.state;
  const index = doc.resolve(pos).index(0);
  let heading: string | null = null;
  let ordinal = 0;
  let label = "paragraph";
  for (let i = 0; i <= index && i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type.name === "heading" && i < index) {
      heading = `${"#".repeat(child.attrs.level ?? 1)} ${child.textContent}`;
      ordinal = 0;
      continue;
    }
    ordinal++;
    if (i === index) label = BLOCK_LABELS[child.type.name] ?? child.type.name;
  }
  if (doc.child(index)?.type.name === "heading") {
    const h = doc.child(index);
    return `${"#".repeat(h.attrs.level ?? 1)} ${h.textContent}`;
  }
  return [heading, `${label} ${ordinal}`].filter(Boolean).join(" › ");
}
