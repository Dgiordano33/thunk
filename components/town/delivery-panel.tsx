"use client";

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
  return <div className="space-y-3 text-xs">
    {delivery ? <>
      <p className="text-muted-foreground break-all font-mono">{delivery.status.branch || "No branch"}
        {delivery.git && ` · ↑${delivery.git.ahead ?? "?"} ↓${delivery.git.behind ?? "?"}${delivery.git.dirty ? " · uncommitted changes" : ""}`}
      </p>
      {delivery.error && <p role="status" className="text-amber-600 dark:text-amber-400">{delivery.error}</p>}
      <PrButton workspaceId={workspaceId} deliveryStatus={delivery.status} inline />
      {!delivery.status.pr && <p className="text-muted-foreground">{delivery.status.reason || "No open pull request"}</p>}
    </> : <p className="text-muted-foreground">Loading delivery status…</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={!runtime || pending || runtime.busy || runtime.archived || (!running && !runtime.scripts.run)} onClick={() => void control()}>
        {pending ? "Working…" : running ? "Stop dev server" : "Start dev server"}
      </Button>
      {preview && <Button size="sm" variant="outline" asChild><a href={preview} target="_blank" rel="noreferrer">{delivery?.deployedPreviewUrl ? "Deployed preview" : "Local preview"} →</a></Button>}
      {delivery?.deployedPreviewUrl && runtime?.previewUrl && <a href={runtime.previewUrl} target="_blank" rel="noreferrer" className="underline">Local preview →</a>}
    </div>
    {runtime && !runtime.scripts.run && <p className="text-muted-foreground">Configure a run script in thunk.json to start a local preview.</p>}
    {running && !runtime?.previewUrl && <p className="text-muted-foreground">Dev server running; waiting for its preview port.</p>}
    {Boolean(delivery?.activity?.length) && <div className="border-t pt-3">
      <h4 className="mb-2 font-medium">Recent delivery activity</h4>
      <ol className="space-y-2">
        {delivery!.activity.map((event) => <li key={event.id} className="flex items-start justify-between gap-2">
          <a href={event.previewUrl || event.pr.url} target="_blank" rel="noreferrer" className="hover:underline">{DELIVERY_EVENT_LABELS[event.type]} · #{event.pr.number}</a>
          <time dateTime={event.at} title={new Date(event.at).toLocaleString()} className="text-muted-foreground shrink-0">{relativeTime(event.at)}</time>
        </li>)}
      </ol>
    </div>}
    {(error || runtime?.setupError) && <p role="alert" className="text-destructive">{error || runtime?.setupError}</p>}
  </div>;
}
