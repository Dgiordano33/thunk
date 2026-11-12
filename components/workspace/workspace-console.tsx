"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, PlayIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/client/api";
import type { ProcessKind, ProcessSnapshot, RuntimeSnapshot } from "@/lib/projects/runtime-types";
import type { workspaceGitState } from "@/lib/projects/workspace-git";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

type GitState = Awaited<ReturnType<typeof workspaceGitState>>;
const KINDS: ProcessKind[] = ["shell", "setup", "run", "archive"];
const LABELS: Record<ProcessKind, string> = { shell: "Terminal", setup: "Setup", run: "Run", archive: "Archive" };
const EMPTY: Record<ProcessKind, string> = {
  shell: "No shell running. Click New shell to open one.",
  setup: "Setup hasn't run yet. Click Run setup to run the setup script.",
  run: "Dev server isn't running. Click Start server to launch it.",
  archive: "The archive hook hasn't run.",
};

export function WorkspaceConsole({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ProcessKind | "preview">("shell");
  const [state, setState] = useState<RuntimeSnapshot | null>(null);
  const [git, setGit] = useState<GitState>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [gitAction, setGitAction] = useState("sync");
  const [cleanup, setCleanup] = useState(false);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      api.workspaceRuntime(workspaceId), api.workspaceGit(workspaceId),
    ]);
    if (results[0].status === "fulfilled") setState(results[0].value);
    else setError(results[0].reason.message);
    if (results[1].status === "fulfilled") setGit(results[1].value.git);
  }, [workspaceId]);
  const fastPoll = open || !!state?.processes.some((p) => p.running);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") await refresh();
      if (active) timer = setTimeout(poll, fastPoll ? 3000 : 15000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh, fastPoll]);

  const act = async (action: () => Promise<unknown>, refreshRoute = true) => {
    setBusy(true); setError("");
    try { await action(); if (refreshRoute) router.refresh(); }
    catch (err) { setError((err as Error).message); setOpen(true); }
    finally { setBusy(false); await refresh(); }
  };
  const start = (kind: Exclude<ProcessKind, "archive">) => {
    setTab(kind); setOpen(true);
    void act(() => api.workspaceProcess(workspaceId, { action: kind }), false);
  };
  const selectTab = (kind: ProcessKind | "preview") => {
    if (open && tab === kind) { setOpen(false); return; }
    setTab(kind); setOpen(true);
    if (kind === "shell" && !state?.processes.some((p) => p.kind === "shell") && !state?.archived && !state?.busy) start("shell");
  };
  const selected = state?.processes.find((p) => p.kind === tab);
  const blocked = busy || state?.busy || state?.archived;
  // Multi-repo workspaces report every repo; actions without a repo id apply to all of them.
  const repos = git?.repos ?? [];
  const multi = repos.length > 1;
  const conflicts = [...new Set(repos.flatMap((r) => [...r.conflicts, ...r.rootConflicts].map((f) => multi ? `${r.name}: ${f}` : f)))];
  const canManage = repos.some((r) => r.canManage);
  const mergeOpen = repos.some((r) => r.operation === "merge" || r.rootOperation === "merge");
  const rebaseOpen = repos.some((r) => r.operation === "rebase");
  const inRoot = repos.some((r) => r.rootConflicts.length);

  const applyGit = () => {
    const merging = gitAction === "merge" || gitAction === "squash";
    const into = multi ? "each repo's default branch" : `local ${git?.target}`;
    if (merging && !window.confirm(`${gitAction === "squash" ? "Squash" : "Merge"} committed workspace changes into ${into}?${cleanup ? " Then run the archive hook and delete this workspace and its sessions." : ""}`)) return;
    void act(async () => {
      const result = await api.workspaceGitAction(workspaceId, gitAction, merging && cleanup);
      if (result.deleted) { router.push("/projects"); return; }
    });
  };

  return (
    <section className="bg-background shrink-0 border-t" aria-label="Workspace tools" onKeyDown={(event) => event.stopPropagation()}>
      <div className="flex min-h-10 flex-wrap items-center gap-1 px-2 py-1">
        {KINDS.map((kind) => {
          const proc = state?.processes.find((p) => p.kind === kind);
          if (kind === "archive" && !proc) return null;
          return <Button className="pixel text-xs" key={kind} size="sm" variant={open && tab === kind ? "secondary" : "ghost"} onClick={() => selectTab(kind)} aria-pressed={open && tab === kind}>
            {kind === "shell" && <TerminalIcon className="size-3.5" />}
            {LABELS[kind]}
            {proc && <span className={proc.running ? "text-emerald-600 dark:text-emerald-400" : proc.exitCode ? "text-destructive" : "text-muted-foreground"} title={proc.running ? "Running" : `Exited with code ${proc.exitCode}`}>{proc.running ? "●" : proc.exitCode ? "✕" : "✓"}</span>}
          </Button>;
        })}
        {state?.previewUrl && <Button size="sm" variant={open && tab === "preview" ? "secondary" : "ghost"} onClick={() => selectTab("preview")}>Preview</Button>}
        {(state?.setupError || error || conflicts.length > 0) && <span className="text-destructive text-xs">{conflicts.length ? `${conflicts.length} conflicts` : "Needs attention"}</span>}
        <span className="flex-1" />
        {open && tab !== "preview" && (selected?.running
          ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => api.workspaceProcess(workspaceId, { action: "stop", kind: selected.kind }), false)}>
              <SquareIcon className="size-3" /> {tab === "run" ? "Stop server" : "Stop"}
            </Button>
          : tab !== "archive" && <Button size="sm" variant="outline" disabled={blocked || (tab === "run" && !state?.scripts.run)} onClick={() => start(tab)}>
              {tab === "run" ? <><PlayIcon className="size-3" /> Start server</> : tab === "setup" ? "Run setup" : "New shell"}
            </Button>)}
        {tab === "run" && state?.port ? <span className="text-muted-foreground text-xs">:{state.port}</span> : null}
        {tab === "preview" && state?.previewUrl && <a href={state.previewUrl} target="_blank" rel="noreferrer" aria-label="Open dev server in new tab" className="text-muted-foreground px-1"><ExternalLinkIcon className="size-3.5" /></a>}
        {!open && repos.filter((r) => r.target).map((r) => <span key={r.id} className="text-muted-foreground whitespace-nowrap px-1 text-xs" title={`${multi ? `${r.name}: ` : ""}${r.ahead} ahead, ${r.behind} behind ${r.target}`}>{multi && `${r.name} `}{r.ahead}↑ {r.behind}↓{!multi && ` ${r.target}`}</span>)}
        <Button size="icon-sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Collapse console" : "Expand console"}>
          {open ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </div>
      {open && <div className="flex h-[min(50vh,420px)] min-h-64 flex-col border-t">
        {(error || state?.setupError) && <p role="alert" className="text-destructive max-h-24 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs">{error || state?.setupError}</p>}
        {canManage && <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1">
          <Select value={gitAction} onValueChange={setGitAction}>
            <SelectTrigger size="sm" className="w-44" aria-label="Git action"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sync">Sync with {multi ? "default branches" : git?.target}</SelectItem>
              <SelectItem value="rebase">Rebase onto {multi ? "default branches" : git?.target}</SelectItem>
              <SelectItem value="merge">Merge into {multi ? "default branches" : git?.target}</SelectItem>
              <SelectItem value="squash">Squash into {multi ? "default branches" : git?.target}</SelectItem>
            </SelectContent>
          </Select>
          {(gitAction === "merge" || gitAction === "squash") && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={cleanup} onChange={(e) => setCleanup(e.target.checked)} /> Then delete workspace</label>}
          <Button size="sm" variant="outline" disabled={blocked} onClick={applyGit}>Apply</Button>
          {mergeOpen && <Button size="sm" variant="outline" disabled={blocked} onClick={() => void act(() => api.workspaceGitAction(workspaceId, "merge-abort"))}>Abort merge</Button>}
          {rebaseOpen && <>
            <Button size="sm" variant="outline" disabled={blocked || conflicts.length > 0} onClick={() => void act(() => api.workspaceGitAction(workspaceId, "rebase-continue"))}>Continue rebase</Button>
            <Button size="sm" variant="outline" disabled={blocked} onClick={() => void act(() => api.workspaceGitAction(workspaceId, "rebase-abort"))}>Abort rebase</Button>
          </>}
          <Button size="sm" variant="ghost" disabled={blocked} onClick={() => {
            if (window.confirm("Run the archive hook and close this workspace’s terminals and agents? The worktree will be kept.")) {
              void act(async () => { await api.updateWorkspace(workspaceId, { status: "archived" }); });
            }
          }}>{state?.archived ? "Archived" : "Archive"}</Button>
        </div>}
        {conflicts.length > 0 && <p role="alert" className="text-destructive max-h-20 overflow-auto px-3 py-2 text-xs">Resolve and stage these files in {inRoot ? (multi ? "each repo's main checkout" : "the project root") : "the workspace"}: {conflicts.join(", ")}. {mergeOpen ? "Commit the merge in the terminal, or abort." : "Then continue the rebase, or abort."}</p>}
        {tab === "preview" ? state?.previewUrl
          ? <iframe title="Workspace preview" src={state.previewUrl} className="min-h-0 flex-1 bg-white" sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads" />
          : <p className="text-muted-foreground p-4 text-sm">Start the dev server to preview it.</p>
          : <WorkspaceTerminal key={`${workspaceId}:${tab}:${selected?.id ?? "empty"}`} workspaceId={workspaceId} process={selected} empty={EMPTY[tab]} />}
      </div>}
    </section>
  );
}

function WorkspaceTerminal({ workspaceId, process: proc, empty }: { workspaceId: string; process?: ProcessSnapshot; empty: string }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const current = useRef(proc);
  const [error, setError] = useState("");
  useEffect(() => { current.current = proc; }, [proc]);
  useEffect(() => {
    let disposed = false;
    let teardown = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !host.current) return;
      const terminal = new Terminal({ fontSize: 12, fontFamily: getComputedStyle(host.current).getPropertyValue("--font-mono") + ", monospace", cursorBlink: true, scrollback: 3000, theme: { background: getComputedStyle(host.current).backgroundColor, foreground: getComputedStyle(host.current).color } });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(host.current);
      term.current = terminal;
      let queue = Promise.resolve();
      const send = (body: { data?: string; cols?: number; rows?: number }) => {
        if (!current.current?.running) return;
        queue = queue.then(async () => {
          if (disposed) return;
          await api.workspaceProcess(workspaceId, { action: "input", processId: current.current!.id, ...body });
        }).catch((err) => { if (!disposed) setError(err.message); });
      };
      const input = terminal.onData((data) => send({ data }));
      const observer = new ResizeObserver(() => {
        if (!host.current?.clientWidth || !host.current.clientHeight) return;
        fit.fit(); send({ cols: terminal.cols, rows: terminal.rows });
      });
      observer.observe(host.current);
      const snapshot = current.current;
      let stream: EventSource | undefined;
      if (snapshot) {
        stream = new EventSource(`/api/workspaces/${workspaceId}/terminal?processId=${snapshot.id}`);
        stream.onopen = () => setError("");
        stream.onmessage = (event) => {
          const data = JSON.parse(event.data) as { output: string; reset: boolean; done: boolean };
          if (data.reset) terminal.reset();
          terminal.write(data.output);
          if (data.done) stream?.close();
        };
        stream.onerror = () => setError("Terminal disconnected. Reconnecting…");
      } else terminal.writeln(empty);
      teardown = () => { stream?.close(); observer.disconnect(); input.dispose(); terminal.dispose(); term.current = null; };
    })().catch((err) => setError(err.message));
    return () => { disposed = true; teardown(); };
  }, [workspaceId, empty]);
  return <div className="relative min-h-0 flex-1 bg-background p-2">
    {error && <p role="alert" className="absolute top-1 right-2 z-10 bg-red-950 p-1 text-xs text-white">{error}</p>}
    <div ref={host} className="bg-background text-foreground h-full w-full" aria-label="Workspace terminal" />
  </div>;
}
