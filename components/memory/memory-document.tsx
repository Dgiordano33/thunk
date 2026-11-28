"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { editorExtensions } from "@/lib/editor/extensions";
import { ChangeMark } from "@/lib/editor/extensions/change-mark";
import { MemoryHeading } from "@/lib/editor/memory-heading";
import { docToMarkdown } from "@/lib/editor/markdown";

/** A line of added markdown as it reads in the editor: list, task and heading markers dropped. */
const plainLine = (line: string) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, "").replace(/^#{1,6}\s+/, "").trim();

/** Mark every block whose text contains an added line, so the person sees what the proposal put in. */
function markChanges(editor: Editor, added: string[]) {
  const lines = [...new Set(added.flatMap((text) => text.split("\n").map(plainLine)).filter((l) => l.length > 2))];
  if (!lines.length) return;
  const type = editor.schema.marks.change;
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const text = node.textContent;
    for (const line of lines) {
      const at = text.indexOf(line);
      // Offsets map 1:1 onto positions only in blocks of plain text; skip blocks with inline nodes such as hard breaks.
      if (at >= 0 && node.content.size === text.length) tr.addMark(pos + 1 + at, pos + 1 + at + line.length, type.create());
    }
    return false;
  });
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

/** "Edit as document": the resulting MEMORY.md in the rich editor, added text marked. Reports its markdown on every edit. */
export function MemoryDocument({ markdown, added, onChange }: { markdown: string; added: string[]; onChange: (markdown: string) => void }) {
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  const extensions = useMemo(() => [...editorExtensions({ placeholder: "Nothing remembered yet" }), MemoryHeading, ChangeMark], []);
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: markdown,
    contentType: "markdown",
    editorProps: { attributes: { class: "focus:outline-none min-h-64", spellcheck: "true", "aria-label": "Resulting project memory" } },
    onCreate: ({ editor }) => { markChanges(editor, added); changeRef.current(docToMarkdown(editor)); },
    onUpdate: ({ editor }) => changeRef.current(docToMarkdown(editor)),
  });
  return <div className="doc-prose"><EditorContent editor={editor} /></div>;
}
