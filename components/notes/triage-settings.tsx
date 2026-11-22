"use client";

import { CalendarClockIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hint } from "@/components/hint";
import { api } from "@/lib/client/api";
import type { TriageSettings as Triage } from "@/lib/home/triage-types";

/** `m h * * 1-5` or `m h * * *`; anything else keeps the default form values. */
function fromCron(cron: string) {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/.exec(cron.trim());
  return m ? { time: `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`, weekdays: m[3] === "1-5" } : { time: "08:30", weekdays: true };
}

/** Notes sidebar: a button that opens the triage schedule. */
export function TriageSettings() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { api.getTriage().then((r) => setEnabled(r.triage.enabled)).catch(() => {}); }, []);
  return (
    <Popover>
      <Hint label={enabled ? "Daily triage is on" : "Daily triage"}>
        <PopoverTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Daily triage" className={enabled ? "text-foreground" : "text-muted-foreground"}>
            <CalendarClockIcon />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="start" className="w-72 text-xs">
        <TriageForm onChange={(t) => setEnabled(t.enabled)} />
      </PopoverContent>
    </Popover>
  );
}

/** When the top chief reads the top-level notes on its own and writes the day's summary. Also in Settings → Automation. */
export function TriageForm({ onChange }: { onChange?: (triage: Triage) => void }) {
  const [triage, setTriage] = useState<Triage | null>(null);
  const [form, setForm] = useState({ enabled: false, time: "08:30", weekdays: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = (t: Triage) => { setTriage(t); onChange?.(t); setForm({ enabled: t.enabled, ...fromCron(t.cron) }); };
  useEffect(() => { api.getTriage().then((r) => load(r.triage)).catch((err: Error) => setMessage(err.message)); }, []);

  const save = async (next: typeof form) => {
    setForm(next);
    setBusy(true);
    setMessage(null);
    const [h, m] = next.time.split(":").map(Number);
    try {
      load((await api.saveTriage({ enabled: next.enabled, cron: `${m} ${h} * * ${next.weekdays ? "1-5" : "*"}`, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })).triage);
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  };
  const runNow = async () => {
    setBusy(true);
    setMessage(null);
    try { const r = await api.runTriage(); load(r.triage); setMessage(r.result); } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="text-sm font-medium">Daily triage</p>
        <p className="text-muted-foreground mt-1 leading-relaxed">The top chief reads your top-level notes, proposes where unrouted items go (you approve in the Inbox) and writes the day&apos;s summary to the work log.</p>
      </div>
      <label className="flex items-center gap-2">
        <Checkbox checked={form.enabled} disabled={busy || !triage} onCheckedChange={(v) => void save({ ...form, enabled: v === true })} />
        <span>Run on a schedule</span>
      </label>
      <div className="flex items-center gap-2">
        <input type="time" value={form.time} disabled={busy || !triage} aria-label="Triage time"
          onChange={(e) => setForm({ ...form, time: e.target.value })} onBlur={() => triage && fromCron(triage.cron).time !== form.time && void save(form)}
          className="bg-background focus-visible:ring-ring h-7 rounded-md border px-2 outline-none focus-visible:ring-2" />
        <Select value={form.weekdays ? "weekdays" : "daily"} disabled={busy || !triage} onValueChange={(v) => void save({ ...form, weekdays: v === "weekdays" })}>
          <SelectTrigger size="sm" aria-label="Triage days" className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekdays">Weekdays</SelectItem>
            <SelectItem value="daily">Every day</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-muted-foreground space-y-0.5">
        {triage?.enabled && triage.nextRunAt && <p>Next: {new Date(triage.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>}
        {triage?.lastRunAt && <p>Last: {relativeTime(triage.lastRunAt)} · {triage.lastResult}</p>}
        {message && <p className="text-foreground">{message}</p>}
      </div>
      <Button size="xs" variant="outline" disabled={busy || !triage} onClick={() => void runNow()}>Triage now</Button>
    </div>
  );
}
