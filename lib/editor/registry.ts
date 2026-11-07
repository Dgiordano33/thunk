import type { Editor } from "@tiptap/core";

/** Live TipTap instances by document id. Kept out of the store: editors aren't serializable. */
const editors = new Map<string, Editor>();

export function registerEditor(documentId: string, editor: Editor) {
  editors.set(documentId, editor);
  return () => {
    if (editors.get(documentId) === editor) editors.delete(documentId);
  };
}

export function getEditor(documentId: string) {
  return editors.get(documentId);
}
