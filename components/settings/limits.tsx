"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { LIMIT_FIELDS, type LimitKey, type Limits } from "@/lib/setup/limits-schema";
import { SettingGroup, SettingRow } from "./setting-row";

type Field = (typeof LIMIT_FIELDS)[number];

async function request(init?: RequestInit): Promise<Limits> {
  const response = await fetch("/api/settings/limits", { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function LimitInput({ field, value, onSave }: { field: Field; value: number | undefined; onSave: (key: LimitKey, n: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const n = Number(draft);
  const invalid = draft !== "" && (!Number.isInteger(n) || n < field.min || n > field.max);
  const commit = () => {
    if (value === undefined || draft === String(value)) return;
    if (draft === "" || invalid) { setDraft(String(value)); toast.error(`${field.label}: use a whole number from ${field.min} to ${field.max}.`); return; }
    void onSave(field.key, n).then((ok) => { if (!ok) setDraft(String(value)); });
  };
  const id = `limit-${field.key}`;
  return (
    <SettingRow label={field.label} htmlFor={id} description={<>{field.description} Default {field.default}, {field.min}–{field.max}.</>}>
      <Input id={id} type="number" inputMode="numeric" min={field.min} max={field.max} step={1} className="w-20 text-right tabular-nums"
        disabled={value === undefined} aria-invalid={invalid || undefined} value={draft}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setDraft(value === undefined ? "" : String(value)); }} />
      <span className="text-muted-foreground w-14 text-xs">{field.unit}</span>
    </SettingRow>
  );
}

/** Server-wide limits from `config/limits.json`. Self-contained so Settings → Automation can mount it beside other blocks. */
export function LimitsSettings() {
  const [limits, setLimits] = useState<Limits | null>(null);
  useEffect(() => { void request().then(setLimits).catch((e: Error) => toast.error(`Could not load limits: ${e.message}`)); }, []);
  const save = async (key: LimitKey, n: number) => {
    try { setLimits(await request({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ [key]: n }) })); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
  };
  return (
    <SettingGroup title="This server" description="Limits for everything running on this Thunk server, whichever device you change them from. A change applies to the next worker, run or question, with no restart. Running chiefs keep the numbers they started with in their instructions.">
      {LIMIT_FIELDS.map((field) => <LimitInput key={`${field.key}:${limits?.[field.key] ?? ""}`} field={field} value={limits?.[field.key]} onSave={save} />)}
    </SettingGroup>
  );
}
