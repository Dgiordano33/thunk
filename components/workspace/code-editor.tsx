"use client";

import { indentWithTab } from "@codemirror/commands";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

export type CodeEditorHandle = {
  /** Replace the whole document (a reload from disk), keeping the cursor where it can. */
  setContent: (text: string) => void;
  focus: () => void;
};

const chrome = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, monospace", lineHeight: "1.6" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--muted) 55%, transparent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--ring) 35%, transparent)",
  },
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)" },
  ".cm-tooltip": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" },
});

const isDark = () => document.documentElement.classList.contains("dark");
// basicSetup's default highlighting is a fallback, so the dark style wins whenever it's present.
const highlightFor = (dark: boolean) => (dark ? syntaxHighlighting(oneDarkHighlightStyle) : []);

/** A CodeMirror editor for one file. Remount (via `key`) to switch files. */
export function CodeEditor({ filename, initial, onChange, onSave, ref }: {
  filename: string;
  initial: string;
  onChange: (text: string) => void;
  onSave: () => void;
  ref?: Ref<CodeEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks without rebuilding the editor.
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useImperativeHandle(ref, () => ({
    setContent: (text) => {
      const v = view.current;
      if (!v || v.state.doc.toString() === text) return;
      const head = Math.min(v.state.selection.main.head, text.length);
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: { anchor: head } });
    },
    focus: () => view.current?.focus(),
  }), []);

  useEffect(() => {
    const language = new Compartment();
    const highlight = new Compartment();
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { handlers.current.onSave(); return true; } },
            indentWithTab,
          ]),
          chrome,
          highlight.of(highlightFor(isDark())),
          language.of([]),
          EditorView.updateListener.of((u) => { if (u.docChanged) handlers.current.onChange(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;

    // Language support loads lazily, by file name.
    let cancelled = false;
    LanguageDescription.matchFilename(languages, filename)?.load().then((support) => {
      if (!cancelled) v.dispatch({ effects: language.reconfigure(support) });
    }).catch(() => { /* Plain text it is. */ });

    // Follow the app theme as it toggles.
    const observer = new MutationObserver(() => v.dispatch({ effects: highlight.reconfigure(highlightFor(isDark())) }));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      cancelled = true;
      observer.disconnect();
      v.destroy();
      view.current = null;
    };
    // The editor is built once per mount; `initial` only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  return <div ref={host} className="h-full min-h-0" />;
}
