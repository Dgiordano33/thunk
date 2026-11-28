"use client";
import { useOnboarding } from "@/components/onboarding/provider";
import { OnboardingHint } from "@/components/onboarding/hint";

import { Loader2Icon, SaveIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ProposalReview } from "@/components/memory/proposal-review";
import { api } from "@/lib/client/api";
import type { HarvestData } from "@/lib/projects/harvest";
import { toast } from "sonner";
import { Hint } from "@/components/hint";

export type HarvestAction = "harvest" | "delete" | "merge" | "archive";
const POLL_MS = 2000;

type Proposing = { sessionId: string; proposalId: string | null; state: "working" | "awaiting" | "stopped" | "proposed" };

export function HarvestDialog({ workspaceId, label, data, action, hasGit = false, onClose, onComplete }: {
  hasGit?: boolean; workspaceId: string; label: string; data: HarvestData; action: HarvestAction; onClose: () => void; onComplete: () => void;
}) {
  const onboarding = useOnboarding();
  const [memory, setMemory] = useState(data.suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [harvested, setHarvested] = useState(false);
  const [proposing, setProposing] = useState<Proposing | null>(null);
  const verb = action === "merge" ? "merge and delete" : action === "archive" ? "archive" : "delete";
  const actionLabel = action === "merge" ? "Merge and delete" : action === "archive" ? "Archive" : "Delete";

  // Wait for the proposal session's memory_propose call, or for it to stop without one.
  const waitingOn = proposing && !proposing.proposalId && proposing.state !== "stopped" ? proposing.sessionId : null;
  useEffect(() => {
    if (!waitingOn) return;
    let cancelled = false;
    const timer = setInterval(() => {
      api.harvestProposalStatus(workspaceId, waitingOn).then((s) => {
        if (!cancelled) setProposing((p) => p && p.sessionId === waitingOn ? { ...p, state: s.state, proposalId: s.proposal?.id ?? null } : p);
      }, () => {});
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [waitingOn, workspaceId]);

  async function propose() {
    setBusy(true); setError("");
    try {
      const { sessionId } = await api.proposeHarvest(workspaceId);
      setProposing({ sessionId, proposalId: null, state: "working" });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function submit(keep: boolean) {
    setBusy(true); setError("");
    try {
      if (keep && !harvested) {
        await api.harvestWorkspace(workspaceId, { memory, noteIds: [] });
        setHarvested(true);
      }
      if (action === "delete") {
        const result = await api.deleteWorkspace(workspaceId, { worktree: true });
        if (result.retainedDirectory) toast.info("Some files were kept", { description: result.retainedDirectory });
      }
      if (action === "merge") await api.workspaceGitAction(workspaceId, "merge", true);
      if (action === "archive") await api.updateWorkspace(workspaceId, { status: "archived" });
      if (!data.empty) onboarding.markSeen("harvest");
      onComplete(); onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  const reviewed = (status: string) => {
    setHarvested(true);
    if (!data.empty) onboarding.markSeen("harvest");
    if (action === "harvest" && status === "applied") { onComplete(); onClose(); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Harvest · {label}</DialogTitle><DialogDescription>Keep what this workspace learned in project memory. Add the task log as is, or have an agent propose a reviewable update that can also replace or remove entries. Notes already belong to the project and stay there when this workspace closes. Remaining task logs are kept in the granary when the workspace is deleted.</DialogDescription></DialogHeader>
      {!data.empty && <OnboardingHint name="harvest">Harvest keeps what this workspace learned in the project. Choose the memory below to share with future sessions.</OnboardingHint>}
      {action === "merge" && <p className="text-sm">Merge committed changes into the local default branch, run the archive hook, then delete the worktree and sessions.</p>}
      {action === "delete" && <p className="text-sm">{hasGit ? "Delete this workspace, its sessions and worktree. Worktree deletion requires committed changes merged into the default branch." : "Delete this workspace and its sessions. Shared folders and non-empty scratch folders are kept."}</p>}
      {proposing ? <section aria-label="Proposed update" className="space-y-3">
        {proposing.proposalId
          ? <ProposalReview compact proposalId={proposing.proposalId} onDone={reviewed} />
          : proposing.state === "stopped"
            ? <p role="status" className="text-sm">The agent finished without proposing a change. <Button variant="link" className="h-auto p-0" onClick={() => setProposing(null)}>Add the log as is instead</Button></p>
            : <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm"><Loader2Icon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{proposing.state === "awaiting" ? "The agent is waiting for you in its session." : "Reading this workspace’s memory, finished tasks and reports…"} It also lands in your Inbox, so you can close this and review it later.</p>}
      </section> : <fieldset disabled={busy || harvested} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div><p className="mb-2 text-sm font-medium">Workspace task log</p><pre className="bg-muted max-h-64 overflow-auto whitespace-pre-wrap rounded p-3 text-xs">{data.memory || "No task log yet."}</pre></div>
          <label className="text-sm font-medium">Keep in project memory<Textarea className="mt-2 min-h-48 font-mono text-xs" value={memory} onChange={e => setMemory(e.target.value)} /></label>
        </div>
        <details><summary className="cursor-pointer text-sm">Project memory today</summary><pre className="bg-muted mt-2 max-h-48 overflow-auto whitespace-pre-wrap p-3 text-xs">{data.projectMemory || "No project memory yet."}</pre></details>
      </fieldset>}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      {harvested && !proposing && <p role="status" className="text-sm">Harvest saved. Retrying will only {verb}.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>{harvested && action === "harvest" ? "Close" : "Cancel"}</Button>
        {action !== "harvest" && !harvested && <Button variant="outline" disabled={busy} onClick={() => submit(false)}>{actionLabel} without harvesting</Button>}
        {!proposing && !harvested && <Hint label="A short read-only session reads this workspace and proposes changes you review"><Button variant="outline" disabled={busy || data.empty} onClick={() => void propose()}><SparklesIcon aria-hidden="true" />Propose an update</Button></Hint>}
        {proposing && !harvested && !proposing.proposalId && <Button variant="outline" disabled={busy} onClick={() => setProposing(null)}>Add as is instead</Button>}
        {!proposing && !harvested && <Button disabled={busy} onClick={() => submit(true)}>{busy ? "Working…" : action === "harvest" ? "Add as is" : `Add as is and ${verb}`}</Button>}
        {harvested && action !== "harvest" && <Button disabled={busy} onClick={() => submit(false)}>{busy ? "Working…" : actionLabel}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}

export function HarvestButton({ workspaceId, label }: { workspaceId: string; label: string }) {
  const router = useRouter();
  const [data, setData] = useState<HarvestData | null>(null);
  const [busy, setBusy] = useState(false);
  return <>
    <Hint label="Copy lessons from this workspace into project memory">
    <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try { setData(await api.getHarvest(workspaceId)); } catch (err) { toast.error((err as Error).message); }
      finally { setBusy(false); }
    }}><SaveIcon /> Save to project</Button>
    </Hint>
    {data && <HarvestDialog workspaceId={workspaceId} label={label} data={data} action="harvest" onClose={() => setData(null)} onComplete={() => router.refresh()} />}
  </>;
}

export function ArchivedHarvestOffer({ workspaceId, label }: { workspaceId: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return <div role="status" className="fixed bottom-16 right-4 z-50 flex items-center gap-3 rounded border bg-background p-3 text-sm shadow-lg">
    {label} archived. <HarvestButton workspaceId={workspaceId} label={label} />
    <Button size="sm" variant="ghost" onClick={() => router.replace(pathname)}>Dismiss</Button>
  </div>;
}
