"use client";

import { CheckIcon, ChevronRightIcon, CopyIcon, GitPullRequestIcon, Loader2Icon, RefreshCwIcon, TerminalSquareIcon, WebhookIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModelSelect } from "@/components/chat/model-select";
import { MODE_LABELS } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { permissionModesFor, providerOf, type HarnessPermissionMode } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { useModels } from "@/lib/client/use-models";
import { cronError, nextRuns } from "@/lib/routines/cron";
import { PROMPT_PLACEHOLDERS } from "@/lib/routines/prompt";
import { ROUTINE_SCHEDULE_PRESETS, type Routine, type RoutineEvent } from "@/lib/routines/types";
import { useAmbient } from "@/lib/store/ambient-store";
import { cn } from "@/lib/utils";

export type FormWorkspace = { id: string; label: string; inPlace: boolean };

const localTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

const timezones = () => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
};

function Field({ label, hint, error, children }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {error ? <p className="text-destructive text-[11px]">{error}</p> : hint ? <p className="text-muted-foreground text-[11px]">{hint}</p> : null}
    </div>
  );
}

function Chip({ on, onClick, disabled, title, children }: { on: boolean; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "focus-visible:ring-ring flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3",
        on ? "border-foreground/30 bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

const presetOf = (cron: string | null) =>
  cron === null ? "none" : (ROUTINE_SCHEDULE_PRESETS.find((p) => p.cron === cron)?.id ?? "custom");

/** Create or edit a routine. Saves through the API and hands back the stored routine. */
export function RoutineForm({
  projectId,
  repo,
  hasRemote,
  workspaces,
  defaultModel,
  routine,
  onSaved,
  onCancel,
}: {
  projectId: string;
  repo: boolean;
  hasRemote: boolean;
  workspaces: FormWorkspace[];
  defaultModel: string;
  routine?: Routine;
  onSaved: (routine: Routine) => void;
  onCancel: () => void;
}) {
  const models = useModels();
  const sessions = useAmbient((s) => s.sessions);
  const inPlace = workspaces.find((w) => w.inPlace);
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [target, setTarget] = useState<string>(
    routine ? (routine.targetKind === "ephemeral" ? "ephemeral" : (routine.targetWorkspaceId ?? "")) : repo ? "ephemeral" : (inPlace?.id ?? ""),
  );
  const [model, setModel] = useState(routine?.model ?? defaultModel);
  const [mode, setMode] = useState<string>(routine?.permissionMode ?? "acceptEdits");
  const [preset, setPreset] = useState<string>(presetOf(routine?.scheduleCron ?? null));
  const [cron, setCron] = useState(routine?.scheduleCron ?? "");
  const [tz, setTz] = useState(routine?.scheduleTz ?? "");
  const [events, setEvents] = useState<RoutineEvent[]>(routine?.events ?? []);
  const [webhook, setWebhook] = useState(Boolean(routine?.webhookToken));
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [catchUp, setCatchUp] = useState(routine?.catchUp ?? "skip");
  const [maxRuns, setMaxRuns] = useState(String(routine?.maxRunsPerDay ?? 24));
  const [maxMinutes, setMaxMinutes] = useState(String(routine?.maxRunMinutes ?? 60));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zones, setZones] = useState<string[]>([]);

  // Browser-only values: the local timezone and the full IANA list.
  useEffect(() => {
    setZones(timezones());
    setTz((t) => t || localTz());
  }, []);

  // Plan mode is Claude-only; fall back while a Codex model is picked.
  const modes = permissionModesFor(providerOf(model));
  const permissionMode = modes.includes(mode as HarnessPermissionMode) ? (mode as HarnessPermissionMode) : "acceptEdits";

  const schedule = preset === "none" ? null : preset === "custom" ? cron.trim() || null : (ROUTINE_SCHEDULE_PRESETS.find((p) => p.id === preset)?.cron ?? null);
  const scheduleError = schedule ? cronError(schedule, tz || null) : preset === "custom" ? "Enter a cron expression" : null;
  const upcoming = useMemo(() => (schedule && !scheduleError ? nextRuns(schedule, tz || null, 3) : []), [schedule, scheduleError, tz]);

  const targetWs = workspaces.find((w) => w.id === target);
  const busyTarget = targetWs && sessions.some((s) => s.workspaceId === targetWs.id && !s.origin && (s.status === "running" || s.status === "awaiting"));

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      name,
      prompt,
      model,
      permissionMode,
      targetKind: target === "ephemeral" ? ("ephemeral" as const) : ("workspace" as const),
      targetWorkspaceId: target === "ephemeral" ? null : target || null,
      scheduleCron: schedule,
      scheduleTz: schedule ? tz || null : null,
      events,
      webhookEnabled: webhook,
      enabled,
      catchUp,
      maxRunsPerDay: Number(maxRuns) || 24,
      maxRunMinutes: Number(maxMinutes) || 60,
    };
    try {
      const { routine: saved } = routine ? await api.updateRoutine(routine.id, body) : await api.createRoutine({ projectId, ...body });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Nightly dependency check" required />
      </Field>

      <Field
        label="Instructions"
        hint={
          <>
            What the agent should do each run. Event fields: {PROMPT_PLACEHOLDERS.map((p, i) => (
              <span key={p}>
                {i > 0 && ", "}
                <code className="font-mono">{p}</code>
              </span>
            ))}
            .
          </>
        }
      >
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          maxLength={20000}
          placeholder="Run `npm run lint`, fix trivial issues, and summarize anything you couldn't fix."
          className="font-mono text-xs"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Runs in"
          hint={
            target === "ephemeral"
              ? "A new worktree each run. Removed when nothing changed; archived for review otherwise."
              : targetWs?.inPlace
                ? undefined
                : "Shares the workspace with any sessions you have open there."
          }
          error={
            targetWs?.inPlace
              ? "Runs in place in the project root, next to your own uncommitted work."
              : busyTarget
                ? "A session of yours is working in this workspace right now."
                : null
          }
        >
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="Pick a workspace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ephemeral" disabled={!repo}>
                Fresh worktree per run{repo ? "" : " (git repos only)"}
              </SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.inPlace ? `${w.label} (in place)` : w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Model">
            <ModelSelect models={models} value={model} onValueChange={setModel} />
          </Field>
          <Field label="Permissions">
            <Select value={permissionMode} onValueChange={setMode}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODE_LABELS[m] ?? m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>
      {permissionMode === "default" && (
        <p className="text-muted-foreground -mt-2 text-[11px]">
          With “Ask before edits”, every edit parks the run as <em>Needs you</em> until you approve it.
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <span className="pixel text-muted-foreground text-[11px] tracking-widest uppercase">Triggers</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Schedule" error={schedule || preset === "custom" ? scheduleError : null}>
            <Select value={preset} onValueChange={(v) => { setPreset(v); if (v === "custom" && !cron) setCron(schedule ?? "0 9 * * *"); }}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUTINE_SCHEDULE_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {schedule !== null || preset === "custom" ? (
            <Field label="Timezone">
              <Select value={tz} onValueChange={setTz}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder="Timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(zones.includes(tz) || !tz ? zones : [tz, ...zones]).map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
        {preset === "custom" && (
          <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="*/30 9-17 * * 1-5" className="h-7 font-mono text-xs" aria-label="Cron expression" />
        )}
        {upcoming.length > 0 && (
          <p className="text-muted-foreground text-[11px]">
            Next: {upcoming.map((d) => d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })).join(" · ")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-muted-foreground mr-1 text-[11px]">Also run when:</span>
          <Chip
            on={events.includes("pr_opened")}
            disabled={!hasRemote}
            title={hasRemote ? "Poll GitHub every ~2 min for new pull requests (not Thunk's own thunk/* branches)" : "Needs a GitHub remote"}
            onClick={() => setEvents((e) => (e.includes("pr_opened") ? e.filter((x) => x !== "pr_opened") : [...e, "pr_opened"]))}
          >
            <GitPullRequestIcon /> A pull request opens
          </Chip>
          <Chip
            on={events.includes("run_failed")}
            title={target === "ephemeral" ? "Any workspace's Run script exits with an error" : "This workspace's Run script exits with an error"}
            onClick={() => setEvents((e) => (e.includes("run_failed") ? e.filter((x) => x !== "run_failed") : [...e, "run_failed"]))}
          >
            <TerminalSquareIcon /> The Run script fails
          </Chip>
          <Chip on={webhook} onClick={() => setWebhook(!webhook)} title="POST to a local URL (git hook, cron, script)">
            <WebhookIcon /> Webhook
          </Chip>
        </div>
        {webhook && <WebhookInfo routine={routine} />}
      </div>

      <Collapsible>
        <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
          <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" /> Limits and catch-up
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-3 pt-3 sm:grid-cols-3">
          <Field label="Max runs per day" hint="Automatic runs only.">
            <Input type="number" min={1} max={200} value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} className="h-7 text-xs" />
          </Field>
          <Field label="Time limit (min)" hint="Interrupts the agent.">
            <Input type="number" min={5} max={480} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} className="h-7 text-xs" />
          </Field>
          <Field label="Missed while off" hint="When Thunk wasn't running.">
            <Select value={catchUp} onValueChange={(v) => setCatchUp(v as typeof catchUp)}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Skip it</SelectItem>
                <SelectItem value="once">Run once on start</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CollapsibleContent>
      </Collapsible>

      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      <div className="flex items-center gap-2 border-t pt-3">
        <Chip on={enabled} onClick={() => setEnabled(!enabled)} title="Disabled routines only run when you press Run now">
          {enabled ? <CheckIcon /> : null} {enabled ? "Enabled" : "Disabled"}
        </Chip>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !name.trim() || !prompt.trim() || !target || Boolean(scheduleError && preset !== "none")}>
            {saving && <Loader2Icon className="animate-spin" />}
            {routine ? "Save" : "Create routine"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The local webhook URL, a ready-to-paste curl, copy and rotate. */
function WebhookInfo({ routine }: { routine?: Routine }) {
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState(routine?.webhookToken ?? null);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  if (!routine || !token)
    return <p className="text-muted-foreground text-[11px]">The webhook URL appears here after you save.</p>;
  const url = `${origin}/api/routines/${routine.id}/webhook?token=${token}`;
  const curl = `curl -X POST '${url}' -H 'content-type: application/json' -d '{"ref":"main"}'`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        <Input readOnly value={curl} className="h-7 font-mono text-[11px]" aria-label="Webhook curl command" onFocus={(e) => e.target.select()} />
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Copy curl command"
          onClick={async () => {
            await navigator.clipboard.writeText(curl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Rotate token"
          title="Rotate token (the old URL stops working)"
          disabled={rotating}
          onClick={async () => {
            setRotating(true);
            try {
              const { routine: r } = await api.updateRoutine(routine.id, { rotateWebhookToken: true });
              setToken(r.webhookToken);
            } finally {
              setRotating(false);
            }
          }}
        >
          <RefreshCwIcon className={cn(rotating && "animate-spin")} />
        </Button>
      </div>
      <p className="text-muted-foreground text-[11px]">
        Reachable only from this machine (git hook, local cron, SSH tunnel). The JSON body becomes <code className="font-mono">{"{{payload}}"}</code>.
      </p>
    </div>
  );
}
