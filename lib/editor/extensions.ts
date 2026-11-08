import type { AnyExtension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { CommentMark } from "./extensions/comment-mark";

/** Schema-defining extensions. Shared by the editor and headless markdown normalization. */
export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    TableKit.configure({ table: { resizable: false } }),
    // `- [ ]` checklists: notes surface unchecked items as tasks.
    TaskList,
    TaskItem.configure({ nested: true }),
    CommentMark,
  ];
}

export function editorExtensions(opts: { placeholder?: string } = {}): AnyExtension[] {
  return [
    ...schemaExtensions(),
    Markdown.configure({ indentation: { style: "space", size: 2 } }),
    Placeholder.configure({ placeholder: opts.placeholder ?? "Empty document" }),
  ];
}
