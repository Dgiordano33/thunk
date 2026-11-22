"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { SetupStatus, SyncSummary } from "@/lib/setup/sync";

/** Exposed by the Mac app's preload when it shows a Thunk server (desktop/app-preload.cjs). */
type DesktopBridge = { syncSetup: () => Promise<SyncSummary>; onSyncProgress: (callback: (text: string) => void) => () => void };
const desktop = () => (typeof window === "undefined" ? undefined : (window as unknown as { thunkDesktop?: DesktopBridge }).thunkDesktop);
const isLoopback = () => typeof window !== "undefined" && ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);

const count = (items: string[], one: string, many = `${one}s`) => `${items.length} ${items.length === 1 ? one : many}`;
const names = (items: string[]) => (items.length ? items.join(", ") : "none");
const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** Settings → Agents: whether sessions load your own Claude Code setup, and a one-click sync from the Mac app. */
export function AgentSetup() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [bridge, setBridge] = useState<DesktopBridge | undefined>(undefined);
  const [local, setLocal] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/setup", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      setStatus(data); setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your setup");
    }
  }, []);
  useEffect(() => { setBridge(desktop()); setLocal(isLoopback()); void load(); }, [load]);

  const toggle = async (on: boolean) => {
    setSaving(true);
    try {
      const response = await fetch("/api/setup", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ claudeUserConfig: on }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      setStatus(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally { setSaving(false); }
  };

  const sync = async () => {
    if (!bridge) return;
    setProgress("Starting…");
    const stop = bridge.onSyncProgress(setProgress);
    try {
      const summary = await bridge.syncSetup();
      toast.success(`Synced ${count(summary.claude.skills, "skill")} and ${count(summary.claude.plugins, "plugin")}. New sessions use them.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Sync failed");
    } finally { stop(); setProgress(null); }
  };

  const here = status?.here;
  const last = status?.lastSync;
  const dropped = last ? [...last.claude.mcp.dropped.map((d) => `Claude ${d.name}: ${d.reason}`), ...last.codex.mcp.dropped.map((d) => `Codex ${d.name}: ${d.reason}`)] : [];

  return <section className="space-y-3 rounded-lg border bg-background p-3 text-sm" aria-labelledby="agent-setup-title">
    <h3 id="agent-setup-title" className="font-medium">Your setup</h3>
    {error && <p role="alert">{error}</p>}
    {!status && !error && <p role="status">Loading…</p>}
    {status && here && <>
      <Label className="items-start text-sm font-normal">
        <Checkbox className="mt-0.5" checked={status.claudeUserConfig} disabled={saving} onCheckedChange={(on) => void toggle(on === true)} />
        <span>
          <span className="block">Use my Claude Code setup in Claude sessions</span>
          <span className="text-muted-foreground block text-xs">Loads <code>~/.claude</code> on {status.host}: skills, plugins, permission rules and MCP servers. Codex always uses <code>~/.codex</code>. Applies to new sessions.</span>
        </span>
      </Label>
      <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt>Claude</dt><dd>{count(here.claude.skills, "skill")} · {count(here.claude.plugins, "plugin")} · MCP: {names(here.claude.mcpServers)}</dd>
        <dt>Codex</dt><dd>{count(here.codex.skills, "skill")} · MCP: {names(here.codex.mcpServers)}</dd>
      </dl>
      {last && <details className="text-xs">
        <summary className="cursor-pointer">Last synced from {last.from.host} {ago(last.syncedAt)} · {last.files.uploaded} of {last.files.total} files changed</summary>
        <div className="text-muted-foreground mt-2 space-y-1">
          <p>Plugins: {names(last.claude.plugins)}</p>
          {last.claude.settingsLeftOut.length > 0 && <p>Left out of Claude settings: {names(last.claude.settingsLeftOut)} (they run tools on the Mac).</p>}
          {dropped.length > 0 && <p>Skipped MCP servers: {dropped.join("; ")}.</p>}
          {last.codex.configLeftOut.length > 0 && <p>Left out of Codex config: {names(last.codex.configLeftOut)}.</p>}
          {last.files.skipped.length > 0 && <p>Too large to send: {last.files.skipped.map((f) => f.path).join(", ")}.</p>}
          <p>Sign-ins are not copied: servers that sign in through a browser still need it here.</p>
        </div>
      </details>}
      {bridge
        ? <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={!!progress} onClick={() => void sync()}>{progress ? "Syncing…" : "Sync from this Mac"}</Button>
            <span role="status" className="text-muted-foreground text-xs">{progress ?? "Copies your Mac's skills, plugins, settings and MCP servers here."}</span>
          </div>
        : !local && <p className="text-muted-foreground text-xs">To copy your Mac&apos;s setup here, open this server in the Thunk Mac app and choose <strong>Sync from this Mac</strong>.</p>}
    </>}
  </section>;
}
