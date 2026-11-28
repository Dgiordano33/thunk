import type { AnyExtension } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { RichBulletList, RichOrderedList, RichTaskList, RichBlockquote, RichMarkdown, RichParagraph, RichHeading, RichTable, BlockIds, Ink, RichBlock, Media, InlineImage, TableOfContents } from "./rich-blocks";
import { CommentMark } from "./extensions/comment-mark";

/** Schema-defining extensions. Shared by the editor and headless markdown normalization. */
export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ bulletList: false, orderedList: false, blockquote: false, paragraph: false, heading: false, link: { openOnClick: false, autolink: true } }),
    TableKit.configure({ table: false }),
    RichTable.configure({ resizable: true }),
    RichParagraph, RichHeading, RichMarkdown, BlockIds, Ink, RichBlock, Media, InlineImage, TableOfContents,
    // `- [ ]` checklists: notes surface unchecked items as tasks.
    RichBulletList, RichOrderedList, RichTaskList, RichBlockquote,
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
