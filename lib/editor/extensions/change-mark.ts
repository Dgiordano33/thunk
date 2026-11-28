import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Highlights text a memory proposal adds, in "Edit as document". Like CommentMark it emits no markdown, so the marks
 * never reach MEMORY.md. Only the memory document editor loads it; the shared schema doesn't include it.
 */
export const ChangeMark = Mark.create({
  name: "change",
  inclusive: false,
  parseHTML() {
    return [{ tag: "span[data-change]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-change": "", class: "change-mark" }), 0];
  },
  renderMarkdown: (node, h) => h.renderChildren(node),
});
