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
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") await refresh();
      if (active) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); router.refresh(); }
    catch (err) { setError((err as Error).message); setOpen(true); }
    finally { setBusy(false); await refresh(); }
  };
  const start = (kind: "setup" | "run" | "shell") => {
    setTab(kind); setOpen(true);
    void act(() => api.workspaceProcess(workspaceId, { action: kind }));
  };
  const run = state?.processes.find((p) => p.kind === "run");
  const selected = state?.processes.find((p) => p.kind === tab);
  const blocked = busy || state?.busy || state?.archived;
  const conflicts = [...new Set([...(git?.conflicts ?? []), ...(git?.rootConflicts ?? [])])];

  const applyGit = () => {
    const merging = gitAction === "merge" || gitAction === "squash";
    if (merging && !window.confirm(`${gitAction === "squash" ? "Squash" : "Merge"} committed workspace changes into local ${git?.target}?${cleanup ? " Then run the archive hook and delete this workspace and its sessions." : ""}`)) return;
    void act(async () => {
      const result = await api.workspaceGitAction(workspaceId, gitAction, merging && cleanup);
      if (result.deleted) { router.push("/"); return; }
    });
  };

  return (
    <section className="bg-background shrink-0 border-t" aria-label="Workspace tools" onKeyDown={(event) => event.stopPropagation()}>
      <div className="flex min-h-10 flex-wrap items-center gap-2 px-3 py-1">
        <Button size="sm" variant="ghost" onClick={() => { if (!open && tab === "shell" && !state?.processes.some((p) => p.kind === "shell") && !state?.archived && !state?.busy) start("shell"); else setOpen(!open); }} aria-expanded={open}>
          <TerminalIcon className="size-3.5" /> Terminal {open ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => start("setup")} disabled={blocked}>
          {state?.processes.find((p) => p.kind === "setup")?.running ? "Setting up…" : "Setup"}
        </Button>
        <Button size="sm" variant="ghost" disabled={blocked || !state?.scripts.run} onClick={() => run?.running
          ? void act(() => api.workspaceProcess(workspaceId, { action: "stop", kind: "run" })) : start("run")}>
          {run?.running ? <SquareIcon className="size-3" /> : <PlayIcon className="size-3" />} {run?.running ? "Stop server" : "Run"}
        </Button>
        {state?.port ? <span className="text-muted-foreground text-xs">:{state.port}</span> : null}
        {state?.previewUrl && <>
          <Button size="sm" variant="ghost" onClick={() => { setTab("preview"); setOpen(true); }}>Preview</Button>
          <a href={state.previewUrl} target="_blank" rel="noreferrer" aria-label="Open dev server" className="text-muted-foreground"><ExternalLinkIcon className="size-3.5" /></a>
        </>}
        {(state?.setupError || error || conflicts.length > 0) && <span className="text-destructive text-xs">{conflicts.length ? `${conflicts.length} conflicts` : "Needs attention"}</span>}
        <span className="flex-1" />
        {git?.target && <span className="text-muted-foreground text-xs">{git.ahead} ahead · {git.behind} behind {git.target}</span>}
      </div>
      {open && <div className="flex h-[min(50vh,420px)] min-h-64 flex-col border-t">
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1">
          {KINDS.map((kind) => {
            const proc = state?.processes.find((p) => p.kind === kind);
            return <Button key={kind} size="sm" variant={tab === kind ? "secondary" : "ghost"} onClick={() => setTab(kind)}>
              {kind === "shell" ? "Terminal" : kind[0].toUpperCase() + kind.slice(1)}
              {proc && <span className={proc.running ? "text-emerald-600" : proc.exitCode ? "text-destructive" : "text-muted-foreground"}>{proc.running ? "●" : `exit ${proc.exitCode}`}</span>}
            </Button>;
          })}
          {state?.previewUrl && <Button size="sm" variant={tab === "preview" ? "secondary" : "ghost"} onClick={() => setTab("preview")}>Preview</Button>}
          <span className="flex-1" />
          {selected?.running && <Button size="sm" variant="ghost" onClick={() => void act(() => api.workspaceProcess(workspaceId, { action: "stop", kind: selected.kind }))}>Stop {selected.kind}</Button>}
          {tab === "shell" && !selected?.running && <Button size="sm" variant="outline" disabled={blocked} onClick={() => start("shell")}>New shell</Button>}
        </div>
        {(error || state?.setupError) && <p role="alert" className="text-destructive max-h-24 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs">{error || state?.setupError}</p>}
        {git?.canManage && <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1">
          <Select value={gitAction} onValueChange={setGitAction}>
            <SelectTrigger size="sm" className="w-44" aria-label="Git action"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sync">Sync with {git.target}</SelectItem>
              <SelectItem value="rebase">Rebase onto {git.target}</SelectItem>
              <SelectItem value="merge">Merge into {git.target}</SelectItem>
              <SelectItem value="squash">Squash into {git.target}</SelectItem>
            </SelectContent>
          </Select>
          {(gitAction === "merge" || gitAction === "squash") && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={cleanup} onChange={(e) => setCleanup(e.target.checked)} /> Then delete workspace</label>}
          <Button size="sm" variant="outline" disabled={blocked} onClick={applyGit}>Apply</Button>
          {(git.operation === "merge" || git.rootOperation === "merge") && <Button size="sm" variant="outline" disabled={blocked} onClick={() => void act(() => api.workspaceGitAction(workspaceId, "merge-abort"))}>Abort merge</Button>}
          {git.operation === "rebase" && <>
            <Button size="sm" variant="outline" disabled={blocked || conflicts.length > 0} onClick={() => void act(() => api.workspaceGitAction(workspaceId, "rebase-continue"))}>Continue rebase</Button>
            <Button size="sm" variant="outline" disabled={blocked} onClick={() => void act(() => api.workspaceGitAction(workspaceId, "rebase-abort"))}>Abort rebase</Button>
          </>}
          <Button size="sm" variant="ghost" disabled={blocked} onClick={() => {
            if (window.confirm("Run the archive hook and close this workspace’s terminals and agents? The worktree will be kept.")) {
              void act(async () => { await api.updateWorkspace(workspaceId, { status: "archived" }); });
            }
          }}>{state?.archived ? "Archived" : "Archive"}</Button>
        </div>}
        {conflicts.length > 0 && <p role="alert" className="text-destructive max-h-20 overflow-auto px-3 py-2 text-xs">Resolve and stage these files in {git?.rootConflicts.length ? "the project root" : "the workspace"}: {conflicts.join(", ")}. {git?.operation === "merge" || git?.rootOperation === "merge" ? "Commit the merge in the terminal, or abort." : "Then continue the rebase, or abort."}</p>}
        {tab === "preview" ? state?.previewUrl
          ? <iframe title="Workspace preview" src={state.previewUrl} className="min-h-0 flex-1 bg-white" sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads" />
          : <p className="text-muted-foreground p-4 text-sm">Start the dev server to preview it.</p>
          : <WorkspaceTerminal key={`${workspaceId}:${tab}:${selected?.id ?? "empty"}`} workspaceId={workspaceId} process={selected} />}
      </div>}
    </section>
  );
}

function WorkspaceTerminal({ workspaceId, process: proc }: { workspaceId: string; process?: ProcessSnapshot }) {
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
      const terminal = new Terminal({ fontSize: 12, fontFamily: "Menlo, monospace", cursorBlink: true, scrollback: 3000, theme: { background: "#111113", foreground: "#eeeeee" } });
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
      } else terminal.writeln("Use New shell to open a terminal, or select Setup / Run to view script output.");
      teardown = () => { stream?.close(); observer.disconnect(); input.dispose(); terminal.dispose(); term.current = null; };
    })().catch((err) => setError(err.message));
    return () => { disposed = true; teardown(); };
  }, [workspaceId]);
  return <div className="relative min-h-0 flex-1 bg-[#111113] p-2">
    {error && <p role="alert" className="absolute top-1 right-2 z-10 bg-red-950 p-1 text-xs text-white">{error}</p>}
    <div ref={host} className="h-full w-full" aria-label="Workspace terminal" />
  </div>;
}
