"use client";

import { ExternalLinkIcon, GitBranchIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { DELIVERY_EVENT_LABELS } from "@/lib/projects/delivery-types";
import { Button } from "@/components/ui/button";
import { PrButton } from "@/components/workspace/pr-button";
import { api } from "@/lib/client/api";
import type { RuntimeSnapshot } from "@/lib/projects/runtime-types";
import { useAmbient } from "@/lib/store/ambient-store";

export function DeliveryPanel({ workspaceId }: { workspaceId: string }) {
  const delivery = useAmbient((s) => s.deliveries.find((d) => d.workspaceId === workspaceId));
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = () => api.workspaceRuntime(workspaceId).then((data) => {
      if (!stopped) { setRuntime(data); setError(null); }
    }).catch((err: Error) => { if (!stopped) setError(err.message); });
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => { stopped = true; clearInterval(timer); };
  }, [workspaceId]);
  const running = runtime?.processes.some((p) => p.kind === "run" && p.running);
  const control = async () => {
    setPending(true);
    setError(null);
    try {
      await api.workspaceProcess(workspaceId, running ? { action: "stop", kind: "run" } : { action: "run" });
      setRuntime(await api.workspaceRuntime(workspaceId));
    } catch (err) { setError((err as Error).message); }
    finally { setPending(false); }
  };
  const preview = delivery?.deployedPreviewUrl || runtime?.previewUrl;
  const git = delivery?.git;
  const showPr = delivery && (delivery.status.pr || delivery.status.canCreate);
  const hint = delivery?.error
    || (!delivery?.status.pr && !delivery?.status.canCreate ? delivery?.status.reason : null)
    || (runtime && !runtime.scripts.run ? "Add a run script in thunk.json for a local preview." : null)
    || (running && !runtime?.previewUrl ? "Dev server running; waiting for its preview port." : null);
  return <div className="space-y-3 text-xs">
    {delivery ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-1 font-mono"><GitBranchIcon className="size-3 shrink-0" /><span className="truncate">{delivery.status.branch || "No branch"}</span></span>
        {git && <span className="text-muted-foreground font-mono tabular-nums" title={`${git.ahead ?? "?"} ahead, ${git.behind ?? "?"} behind`}>↑{git.ahead ?? "?"} ↓{git.behind ?? "?"}</span>}
        {git?.dirty && <span className="text-amber-600 dark:text-amber-400">Uncommitted changes</span>}
      </div>
    ) : <p className="text-muted-foreground">Loading delivery status…</p>}
    {showPr && <PrButton workspaceId={workspaceId} deliveryStatus={delivery.status} inline />}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={!runtime || pending || runtime.busy || runtime.archived || (!running && !runtime.scripts.run)} onClick={() => void control()}>
        {running ? <SquareIcon /> : <PlayIcon />}
        {pending ? "Working…" : running ? "Stop dev server" : "Start dev server"}
      </Button>
      {preview && <Button size="sm" variant="outline" asChild><a href={preview} target="_blank" rel="noreferrer"><ExternalLinkIcon />{delivery?.deployedPreviewUrl ? "Deployed preview" : "Local preview"}</a></Button>}
      {delivery?.deployedPreviewUrl && runtime?.previewUrl && <Button size="sm" variant="ghost" asChild><a href={runtime.previewUrl} target="_blank" rel="noreferrer"><ExternalLinkIcon />Local preview</a></Button>}
    </div>
    {hint && <p role="status" className="text-muted-foreground">{hint}</p>}
    {Boolean(delivery?.activity?.length) && <div className="border-t pt-3">
      <h4 className="text-muted-foreground mb-2">Recent activity</h4>
      <ol className="space-y-1.5">
        {delivery!.activity.map((event) => <li key={event.id} className="flex items-start justify-between gap-2">
          <a href={event.previewUrl || event.pr.url} target="_blank" rel="noreferrer" className="hover:underline">{DELIVERY_EVENT_LABELS[event.type]} · #{event.pr.number}</a>
          <time dateTime={event.at} title={new Date(event.at).toLocaleString()} className="text-muted-foreground shrink-0">{relativeTime(event.at)}</time>
        </li>)}
      </ol>
    </div>}
    {(error || runtime?.setupError) && <p role="alert" className="text-destructive">{error || runtime?.setupError}</p>}
  </div>;
}
