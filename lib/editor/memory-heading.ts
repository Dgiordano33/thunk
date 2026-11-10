import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";

/** Presentation only: the generated heading stays intact in the markdown file. */
export function memoryHeadingDecorations(doc: Node) {
  const heading = doc.firstChild;
  if (heading?.type.name !== "heading" || heading.attrs.level !== 1) return DecorationSet.empty;
  const match = /^(.+)( — )((?:workspace|project) memory)$/.exec(heading.textContent);
  if (!match) return DecorationSet.empty;
  const separator = 1 + match[1].length;
  const title = separator + match[2].length;
  return DecorationSet.create(doc, [
    Decoration.inline(1, separator, { class: "mb-2 block text-xs font-normal tracking-normal text-muted-foreground" }),
    Decoration.inline(separator, title, { class: "sr-only" }),
    Decoration.inline(title, 1 + heading.content.size, { class: "block capitalize" }),
  ]);
}

export const MemoryHeading = Extension.create({
  name: "memoryHeading",
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations: (state) => memoryHeadingDecorations(state.doc) } })];
  },
});
