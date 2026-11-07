import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      setComment: (commentId: string) => ReturnType;
      unsetComment: (commentId: string) => ReturnType;
    };
  }
}

/**
 * Anchors a comment thread to a span. ProseMirror maps mark positions through
 * every edit, so the mark (not stored offsets) is the source of truth. Emits no
 * markdown: comments never leak into the serialized document.
 */
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  // Allow overlapping comments (marks of the same type with different ids).
  excludes: "",

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs) => ({ "data-comment-id": attrs.commentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "comment-mark" }), 0];
  },

  renderMarkdown: (node, h) => h.renderChildren(node),

  addCommands() {
    return {
      setComment:
        (commentId) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId }),
      unsetComment:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks[this.name];
          state.doc.descendants((node, pos) => {
            for (const mark of node.marks) {
              if (mark.type === type && mark.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
              }
            }
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
