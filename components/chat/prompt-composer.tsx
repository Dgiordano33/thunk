"use client";

import { Button } from "@/components/ui/button";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PaperclipIcon, XIcon } from "lucide-react";
import { PromptInput, PromptInputBody, PromptInputTextarea, usePromptInputAttachments } from "@/components/ai-elements/prompt-input";
import { api } from "@/lib/client/api";
import { ImagesSchema, type PromptImage } from "@/lib/prompts/schema";
import { completionAt, fuzzyMatch } from "@/lib/prompts/complete";

type PromptContext = Awaited<ReturnType<typeof api.promptContext>>;
const contextCache = new Map<string, PromptContext>();
const EMPTY_CONTEXT: PromptContext = { files: [], commands: [], notes: [] };

function Images({ disabled }: { disabled?: boolean }) {
  const attachments = usePromptInputAttachments();
  return <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
    <Button variant="ghost" size="icon-xs" type="button" disabled={disabled} onClick={attachments.openFileDialog} aria-label="Attach images" className="text-muted-foreground hover:text-foreground rounded p-1"><PaperclipIcon className="size-4" /></Button>
    {attachments.files.map((file) => <div key={file.id} className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={file.url} alt={file.filename ?? "Attached image"} className="size-14 rounded object-cover" />
      <Button variant="ghost" size="icon-xs" type="button" onClick={() => attachments.remove(file.id)} aria-label={`Remove ${file.filename ?? "image"}`} className="bg-background absolute -top-1 -right-1 rounded-full"><XIcon className="size-3.5" /></Button>
    </div>)}
  </div>;
}

export function PromptComposer({ workspaceId, disabled, placeholder, autoFocus, onSubmit, children }: {
  workspaceId: string;
  disabled?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  onSubmit: (message: { text: string; files: PromptImage[] }) => Promise<void>;
  children: ReactNode;
}) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [context, setContext] = useState<PromptContext>(() => contextCache.get(workspaceId) ?? EMPTY_CONTEXT);
  const [contextWorkspace, setContextWorkspace] = useState(workspaceId);
  if (contextWorkspace !== workspaceId) {
    setContextWorkspace(workspaceId);
    setContext(contextCache.get(workspaceId) ?? EMPTY_CONTEXT);
  }
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const historyIndex = useRef(-1);
  const draft = useRef("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const historyKey = `thunk:prompt-history:${workspaceId}`;

  useEffect(() => {
    let active = true;
    api.promptContext(workspaceId).then((data) => { contextCache.set(workspaceId, data); if (active) setContext(data); }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [workspaceId]);

  const token = dismissed ? null : completionAt(text, cursor);
  // Notes show as "note:<title>" under @ and insert their file path.
  const notePaths = useMemo(() => {
    const paths = new Map<string, string>();
    for (const n of context.notes) {
      const label = `note:${n.title}`;
      paths.set(paths.has(label) ? `${label} · ${n.path.split("/").pop()}` : label, n.path);
    }
    return paths;
  }, [context.notes]);
  const choices = token ? (token.kind === "@" ? [...notePaths.keys(), ...context.files] : context.commands)
    .filter((value) => fuzzyMatch(value, token.query)).sort((a, b) => Number(!a.toLowerCase().includes(token.query.toLowerCase())) - Number(!b.toLowerCase().includes(token.query.toLowerCase())) || a.localeCompare(b)).slice(0, 8) : [];
  const choose = (choice: string) => {
    if (!token) return;
    const value = (token.kind === "@" && notePaths.get(choice)) || choice;
    const insertion = token.kind === "@" && /\s/.test(value) ? `@"${value}" ` : `${token.kind}${value} `;
    setText(text.slice(0, token.start) + insertion + text.slice(token.end));
    setDismissed(true);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(token.start + insertion.length, token.start + insertion.length); });
  };
  const readHistory = (): string[] => {
    try { const value = JSON.parse(localStorage.getItem(historyKey) ?? "[]"); return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(-100) : []; } catch { return []; }
  };

  return <PromptInput accept="image/png,image/jpeg,image/gif,image/webp" multiple maxFiles={5} maxFileSize={5 * 1024 * 1024}
    onError={(err) => setError(err.message)} onSubmit={async (message) => {
      if (disabled || (!message.text.trim() && !message.files.length)) throw new Error("Enter a message or attach an image");
      await onSubmit({ text: message.text, files: ImagesSchema.parse(message.files) });
      const next = [...readHistory().filter((entry) => entry !== message.text), message.text].filter(Boolean).slice(-100);
      try { localStorage.setItem(historyKey, JSON.stringify(next)); } catch { /* History is optional when storage is unavailable. */ }
      historyIndex.current = -1; setText(""); setError("");
    }}>
    <PromptInputBody>
      <Images disabled={disabled} />
      {choices.length > 0 && <div id="prompt-completions" role="listbox" aria-label={token?.kind === "@" ? "Project files and notes" : "Project commands"} className="mx-3 max-h-56 overflow-auto rounded border p-1">
        {choices.map((choice, i) => <Button variant="ghost" size="xs" key={choice} id={`prompt-choice-${i}`} type="button" role="option" aria-selected={i === selected} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(choice)} className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${i === selected ? "bg-accent" : ""}`}>{token?.kind}{choice}</Button>)}
      </div>}
      <PromptInputTextarea ref={textarea} autoFocus={autoFocus} disabled={disabled} placeholder={placeholder} value={text}
        aria-label="Message" aria-autocomplete="list" aria-controls={choices.length ? "prompt-completions" : undefined} aria-activedescendant={choices.length ? `prompt-choice-${selected}` : undefined}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
        onChange={(e) => { setText(e.target.value); setCursor(e.target.selectionStart); setSelected(0); setDismissed(false); historyIndex.current = -1; }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (choices.length) {
            if (e.key === "Escape") { e.preventDefault(); setDismissed(true); }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSelected((selected + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length); }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(choices[selected] ?? choices[0]); }
          } else if ((e.key === "ArrowUp" && (e.currentTarget.selectionStart === 0 || historyIndex.current >= 0)) || (e.key === "ArrowDown" && historyIndex.current >= 0 && e.currentTarget.selectionStart === text.length)) {
            const entries = readHistory();
            if (!entries.length) return;
            e.preventDefault();
            if (historyIndex.current < 0) draft.current = text;
            historyIndex.current = e.key === "ArrowUp" ? Math.min(historyIndex.current + 1, entries.length - 1) : historyIndex.current - 1;
            setText(historyIndex.current < 0 ? draft.current : entries[entries.length - 1 - historyIndex.current]);
            setDismissed(true);
          }
        }} />
      <p className="text-muted-foreground px-3 pb-1 text-[10px]">@ files and notes · / commands · ↑ prompt history · paste or drop images</p>
      {error && <p role="alert" className="text-destructive px-3 text-xs">{error}</p>}
    </PromptInputBody>
    {children}
  </PromptInput>;
}
