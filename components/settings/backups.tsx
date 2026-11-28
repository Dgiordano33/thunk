"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/client/api";
import type { BackupStatus } from "@/lib/backup/types";

const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Settings → Automation: the daily archive of notes, memory, Vault, config and the database. */
export function BackupSettings() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [form, setForm] = useState({ enabled: true, time: "03:00", keep: "7" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = (s: BackupStatus) => { setStatus(s); setForm({ enabled: s.settings.enabled, time: s.settings.time, keep: String(s.settings.keep) }); };
  useEffect(() => { api.getBackups().then(load).catch((err: Error) => setMessage(err.message)); }, []);

  const save = async (next: typeof form) => {
    if (!status) return;
    setForm(next);
    const keep = Number(next.keep);
    if (!Number.isInteger(keep) || keep < 1) return setMessage("Keep at least one backup.");
    setBusy(true);
    setMessage(null);
    try {
      load(await api.saveBackups({ enabled: next.enabled, time: next.time, keep, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, dir: status.settings.dir }));
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  };
  const backUpNow = async () => {
    setBusy(true);
    setMessage(null);
    try { const r = await api.backUpNow(); load(r); setMessage(`Saved ${r.backup.name} (${size(r.backup.size)})`); } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  };

  const last = status?.backups[0];
  const disabled = busy || !status || status.running;
  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="text-sm font-medium">Backups</p>
        <p className="text-muted-foreground mt-1 leading-relaxed">A daily archive of notes, memory, Vault, canvases, settings and the database, kept on this machine. It includes connector tokens, so only your user can read it.</p>
      </div>
      <label className="flex items-center gap-2">
        <Checkbox checked={form.enabled} disabled={disabled} onCheckedChange={(v) => void save({ ...form, enabled: v === true })} />
        <span>Back up every day</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">At</span>
          <input type="time" value={form.time} disabled={disabled} aria-label="Backup time"
            onChange={(e) => setForm({ ...form, time: e.target.value })} onBlur={() => status && status.settings.time !== form.time && form.time && void save(form)}
            className="bg-background focus-visible:ring-ring h-7 rounded-md border px-2 outline-none focus-visible:ring-2" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Keep</span>
          <input type="number" min={1} max={365} value={form.keep} disabled={disabled} aria-label="Backups to keep"
            onChange={(e) => setForm({ ...form, keep: e.target.value })} onBlur={() => status && String(status.settings.keep) !== form.keep && void save(form)}
            className="bg-background focus-visible:ring-ring h-7 w-16 rounded-md border px-2 tabular-nums outline-none focus-visible:ring-2" />
          <span className="text-muted-foreground">backups</span>
        </label>
      </div>
      <div className="text-muted-foreground space-y-0.5">
        {status?.settings.enabled && status.nextRunAt && <p>Next: {new Date(status.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>}
        <p>{last ? <>Last: {relativeTime(last.createdAt)} · <span className="tabular-nums">{size(last.size)}</span></> : status ? "No backups yet" : "Loading…"}</p>
        {status && <p className="truncate font-mono" title={status.dir}>{status.dir}</p>}
        {status?.running && <p>Backing up…</p>}
        {status?.lastError && <p className="text-destructive">Last attempt failed: {status.lastError.message}</p>}
        {message && <p className="text-foreground">{message}</p>}
      </div>
      <Button size="xs" variant="outline" disabled={disabled} onClick={() => void backUpNow()}>Back up now</Button>
    </div>
  );
}
