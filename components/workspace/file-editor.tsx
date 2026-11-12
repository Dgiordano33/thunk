"use client";

import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { FileContent } from "@/lib/projects/types";
import { useSession } from "@/lib/store/session-store";
import { fileKey, useOpenFiles, type OpenFile } from "@/lib/store/open-files-store";
import { cn } from "@/lib/utils";
import { CodeEditor, type CodeEditorHandle } from "./code-editor";

/** How often an open file checks whether something else (usually an agent) changed it on disk. */
const DISK_POLL_MS = 2500;

type Text = Extract<FileContent, { kind: "text" }>;

/** A workspace file in an editor tab: edits stay as a draft until saved, and outside edits never get silently overwritten. */
export function FileEditor({ workspaceId, root, rootLabel, path }: { workspaceId: string; root: string; rootLabel: string | null; path: string }) {
  const file = useMemo<OpenFile>(() => ({ workspaceId, root, path }), [workspaceId, root, path]);
  const key = fileKey(file);
  const editor = useRef<CodeEditorHandle>(null);
  /** What's on disk as of the last load or save: the draft is compared against it. */
  const base = useRef<{ content: string; version: string } | null>(null);
  const [loaded, setLoaded] = useState<FileContent | { kind: "error"; message: string } | null>(null);
  const [initial, setInitial] = useState("");
  /** Disk content that changed underneath unsaved edits. */
  const [conflict, setConflict] = useState<Text | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const dirty = useOpenFiles((s) => !!s.drafts[key]);

  useEffect(() => { useOpenFiles.getState().open(file); }, [file]);

  // Load once per file; resume an unsaved draft from an earlier visit to this tab.
  useEffect(() => {
    let cancelled = false;
    api.readWorkspaceFile(workspaceId, root, path).then((f) => {
      if (cancelled) return;
      if (f.kind === "text") {
        base.current = { content: f.content, version: f.version };
        const draft = useOpenFiles.getState().drafts[key];
        setInitial(draft?.content ?? f.content);
        if (draft && draft.baseVersion !== f.version) setConflict(f);
      }
      setLoaded(f);
    }).catch((err: Error) => { if (!cancelled) setLoaded({ kind: "error", message: err.message }); });
    return () => { cancelled = true; };
  }, [workspaceId, root, path, key]);

  const takeDisk = useCallback((f: Text) => {
    base.current = { content: f.content, version: f.version };
    useOpenFiles.getState().setDraft(file, null);
    editor.current?.setContent(f.content);
    setConflict(null);
  }, [file]);

  // Pick up outside edits: reload silently when clean, flag a conflict when there are unsaved edits.
  const checkDisk = useCallback(async () => {
    if (!base.current || saving) return;
    const res = await api.workspaceFileVersion(workspaceId, root, path).then((r) => r.version, () => null);
    if (res === null) { setMissing(true); return; }
    setMissing(false);
    if (res === base.current.version || res === conflict?.version) return;
    const f = await api.readWorkspaceFile(workspaceId, root, path).catch(() => null);
    if (f?.kind !== "text" || !base.current || f.version === base.current.version) return;
    if (useOpenFiles.getState().drafts[key]) setConflict(f);
    else takeDisk(f);
  }, [workspaceId, root, path, key, saving, conflict, takeDisk]);

  const status = useSession((s) => s.status);
  useEffect(() => {
    if (loaded?.kind !== "text") return;
    void checkDisk();
    const t = setInterval(() => document.visibilityState === "visible" && void checkDisk(), DISK_POLL_MS);
    return () => clearInterval(t);
  }, [loaded, checkDisk, status]);

  const onChange = useCallback((text: string) => {
    if (!base.current) return;
    useOpenFiles.getState().setDraft(file, text === base.current.content ? null : { content: text, baseVersion: base.current.version });
    setSavedAt(null);
  }, [file]);

  const save = useCallback(async (force = false) => {
    const draft = useOpenFiles.getState().drafts[key];
    if (!draft || !base.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.saveWorkspaceFile(workspaceId, root, path, { content: draft.content, baseVersion: base.current.version, force });
      if (res.conflict) { setConflict(res); return; }
      base.current = { content: draft.content, version: res.version };
      // Keep typing that happened while the save was in flight.
      const latest = useOpenFiles.getState().drafts[key];
      useOpenFiles.getState().setDraft(file, latest && latest.content !== draft.content ? { ...latest, baseVersion: res.version } : null);
      setConflict(null);
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }, [workspaceId, root, path, key, file]);

  // Warn before closing the window with unsaved edits in any file.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (Object.keys(useOpenFiles.getState().drafts).length) e.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const slash = path.lastIndexOf("/");
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
        <p className="flex min-w-0 flex-1 items-center text-[13px]" title={path}>
          {rootLabel && <span className="text-muted-foreground shrink-0">{rootLabel}:&nbsp;</span>}
          <span className="text-muted-foreground truncate">{slash >= 0 ? path.slice(0, slash + 1) : ""}</span>
          <span className="shrink-0 font-medium">{path.slice(slash + 1)}</span>
          {dirty && <span className="bg-foreground/70 ml-2 size-1.5 shrink-0 rounded-full" title="Unsaved changes" />}
        </p>
        {saveError && <span role="alert" className="text-destructive truncate text-xs">{saveError}</span>}
        {!saveError && savedAt && !dirty && <span className="text-muted-foreground text-xs">Saved</span>}
        {loaded?.kind === "text" && (
          <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || saving} onClick={() => void save()} title="Save (⌘S)">
            {saving && <Loader2Icon className="size-3.5 animate-spin" />}Save
          </Button>
        )}
      </div>

      {missing && <Banner tone="warn">This file no longer exists on disk. Saving won&apos;t recreate it.</Banner>}
      {conflict && !missing && (
        <Banner tone="warn">
          <span className="flex-1">This file changed on disk while you had unsaved edits.</span>
          <Button size="xs" variant="outline" onClick={() => takeDisk(conflict)}>Reload from disk</Button>
          <Button size="xs" variant="outline" onClick={() => void save(true)}>Keep mine and save</Button>
        </Banner>
      )}

      <div className="min-h-0 flex-1">
        {loaded === null ? (
          <div className="text-muted-foreground flex justify-center p-8"><Loader2Icon className="size-4 animate-spin" /></div>
        ) : loaded.kind === "text" ? (
          <CodeEditor ref={editor} filename={path} initial={initial} onChange={onChange} onSave={() => void save()} />
        ) : (
          <p className="text-muted-foreground p-8 text-center text-sm">
            {loaded.kind === "error" ? `Couldn't open this file: ${loaded.message}`
              : loaded.kind === "binary" ? `Binary file (${formatSize(loaded.size)}) — can't be edited here.`
                : `This file is ${formatSize(loaded.size)}, too large to open in the editor.`}
          </p>
        )}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn"; children: React.ReactNode }) {
  return (
    <div role="status" className={cn("flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs", tone === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
      <AlertTriangleIcon className="size-3.5 shrink-0" />
      {children}
    </div>
  );
}

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
