"use client";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Sync = { at: string; result: { imported: number; updated: number; closed: number } | null; error: string | null } | null;
type LinearStatus = {
  hasKey: boolean; keyHint: string | null; keyFromEnv: boolean;
  projects: { id: string; name: string; team: { teamId: string; teamKey: string; teamName: string } | null; sync: Sync }[];
};
type Teams = { viewer: { name: string; organization: string }; teams: { id: string; key: string; name: string }[] };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function syncLine(sync: Sync) {
  if (!sync) return "Waiting for the first sync";
  if (sync.error) return sync.error;
  const r = sync.result!;
  const parts = [r.imported && `${r.imported} new`, r.updated && `${r.updated} updated`, r.closed && `${r.closed} closed`].filter(Boolean);
  return `Synced ${relativeTime(sync.at)}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
}

/** Settings → Integrations → Linear: a personal API key, then which Linear team feeds each project's tasks. */
export function LinearCard({ status: Status }: { status: React.ComponentType<{ state: "on" | "off" | "setup" }> }) {
  const [status, setStatus] = useState<LinearStatus | null>(null);
  const [teams, setTeams] = useState<Teams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await call<LinearStatus>("/api/integrations/linear");
      setStatus(s); setError(null);
      if (s.hasKey) setTeams(await call<Teams>("/api/integrations/linear/teams").catch((e: Error) => { setError(e.message); return null; }));
      else setTeams(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load Linear settings"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // While any mapped project waits for its first sync, check back.
  const waiting = status?.projects.some((p) => p.team && !p.sync);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void call<LinearStatus>("/api/integrations/linear").then(setStatus).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [waiting]);

  const run = async (label: string, work: () => Promise<string | void>) => {
    setBusy(label); setMessage(null);
    try { const text = await work(); if (text) setMessage({ ok: true, text }); }
    catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" }); }
    finally { setBusy(null); }
  };
  const saveKey = () => run("key", async () => {
    setStatus(await call<LinearStatus>("/api/integrations/linear", { method: "PUT", body: JSON.stringify({ apiKey: key.trim() }) }));
    setKey("");
    setTeams(await call<Teams>("/api/integrations/linear/teams"));
    return "Saved.";
  });
  const mapTeam = (projectId: string, teamId: string | null) => run(projectId, async () => {
    setStatus(await call<LinearStatus>("/api/integrations/linear", { method: "PUT", body: JSON.stringify({ projects: { [projectId]: teamId } }) }));
  });
  const syncNow = () => run("sync", async () => {
    await call("/api/integrations/linear/sync", { method: "POST" });
    setStatus(await call<LinearStatus>("/api/integrations/linear"));
  });

  const mapped = status?.projects.filter((p) => p.team).length ?? 0;
  const state = !status?.hasKey ? "setup" : mapped ? "on" : "off";

  return (
    <section className="rounded-lg border bg-background/60" aria-labelledby="linear-title">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 id="linear-title" className="text-sm font-medium">Linear</h3>
          <p className="text-muted-foreground text-xs">Issues assigned to you become tasks in the project you pick. Linear owns them: changes made there replace edits made here.</p>
        </div>
        {status && <Status state={state} />}
      </header>
      <div className="space-y-4 px-4 py-4">
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        {!status && !error && <p role="status" className="text-muted-foreground text-sm">Loading…</p>}
        {status && <>
          {!status.hasKey && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              Create a personal API key in{" "}
              <a href="https://linear.app/settings/account/security" target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-0.5 underline-offset-2 hover:underline">Linear → Settings → Security &amp; access<ExternalLinkIcon className="size-3" /></a>{" "}
              and paste it here. Agents also get Linear&apos;s tools through the same key.
            </p>
          )}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void saveKey(); }}>
            <label className="min-w-64 flex-1 space-y-1 text-xs">
              <span className="block font-medium">API key</span>
              <Input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} disabled={status.keyFromEnv}
                placeholder={status.keyFromEnv ? "Set by LINEAR_API_KEY" : status.hasKey ? `Saved (${status.keyHint}). Paste to replace.` : "lin_api_…"} />
            </label>
            <Button type="submit" size="sm" disabled={!key.trim() || busy !== null}>{busy === "key" ? "Checking…" : "Save"}</Button>
          </form>
          {teams && <p className="text-muted-foreground text-xs">Connected as {teams.viewer.name} in {teams.viewer.organization}. Agents in every project can use Linear&apos;s tools.</p>}

          {status.hasKey && teams && (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b text-left">
                  <tr><th scope="col" className="px-3 py-2 font-medium">Project</th><th scope="col" className="px-3 py-2 font-medium">Linear team</th><th scope="col" className="px-3 py-2 font-medium">Last sync</th></tr>
                </thead>
                <tbody>
                  {status.projects.map((p) => (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <th scope="row" className="px-3 py-2 text-left font-normal">{p.name}</th>
                      <td className="px-3 py-1.5">
                        <Select value={p.team?.teamId ?? "none"} disabled={busy !== null} onValueChange={(v) => void mapTeam(p.id, v === "none" ? null : v)}>
                          <SelectTrigger size="sm" className="w-48 text-xs" aria-label={`Linear team for ${p.name}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {teams.teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.key})</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={cn("px-3 py-2", p.sync?.error ? "text-destructive" : "text-muted-foreground")}>{p.team ? syncLine(p.sync) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {status.hasKey && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!mapped || busy !== null} onClick={() => void syncNow()}>{busy === "sync" ? "Syncing…" : "Sync now"}</Button>
              <span className="text-muted-foreground text-xs">Syncs every 2 minutes. A worktree started from a Linear task gets a branch with the issue key, so Linear links its PR.</span>
            </div>
          )}
          {message && <p role={message.ok ? "status" : "alert"} className={cn("text-xs", message.ok ? "text-muted-foreground" : "text-destructive")}>{message.text}</p>}
        </>}
      </div>
    </section>
  );
}
