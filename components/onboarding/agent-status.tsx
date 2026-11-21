"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { AgentStatuses } from "@/lib/agent/readiness";
let status: AgentStatuses | null = null;
let error = "";
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function refreshAgents(refresh = false) {
  if (pending) return pending;
  pending = fetch(`/api/agents/status${refresh ? "?refresh=1" : ""}`, { cache: "no-store" }).then(async (r) => {
    if (!r.ok) throw new Error("Could not check agents");
    status = await r.json(); error = "";
  }).catch(() => { error = "Could not check agents. Try again."; }).finally(() => { pending = null; emit(); });
  emit();
  return pending;
}
export function useAgentStatus() {
  const data = useSyncExternalStore(subscribe, () => status, () => null);
  useEffect(() => { if (!status) void refreshAgents(); }, []);
  return data;
}
export function AgentStatus({ onlyUnavailable = false }: { onlyUnavailable?: boolean }) {
  const data = useAgentStatus();
  const message = useSyncExternalStore(subscribe, () => error, () => "");
  const busy = useSyncExternalStore(subscribe, () => !!pending, () => false);
  if (onlyUnavailable && (!data || Object.values(data).some((s) => s.state === "ready"))) return null;
  return <div className="space-y-3 rounded-lg border bg-background p-3 text-sm" aria-label="Agent status">
    {!data && !message && <p role="status">Checking agents…</p>}
    {message && <p role="alert">{message}</p>}
    {data && (["claude", "codex"] as const).map((name) => <div key={name} className="space-y-1">
      <p><strong>{name === "claude" ? "Claude" : "Codex"}</strong> · {data[name].message}</p>
      {data[name].command && <div className="flex flex-wrap items-center gap-2"><code className="break-all text-xs">{data[name].command}</code><Button type="button" size="xs" variant="outline" aria-label={`Copy ${name} command`} onClick={() => navigator.clipboard.writeText(data[name].command!).then(() => toast.success("Copied command"), () => toast.error("Could not copy command"))}>Copy</Button></div>}
    </div>)}
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refreshAgents(true)}>{busy ? "Checking…" : "Check again"}</Button>
  </div>;
}
