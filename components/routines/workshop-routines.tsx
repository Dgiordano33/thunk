"use client";

import { PlusIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { Routine, RoutineSummary } from "@/lib/routines/types";
import { RoutineForm, type FormWorkspace } from "./routine-form";
import { RoutineList, RunNowButton } from "./routine-list";
import { RunHistory } from "./run-history";
import { triggerSummary, useRoutines } from "./shared";

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-4 last:border-b-0">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="pixel text-sm">{title}</h3>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {children}
    </section>
  );
}

/** The Workshop body: standing orders, and `?routine=new|<id>` for the form and run history. */
export function WorkshopRoutines({
  projectId,
  repo,
  hasRemote,
  workspaces,
  defaultModel,
  initial,
}: {
  projectId: string;
  repo: boolean;
  hasRemote: boolean;
  workspaces: FormWorkspace[];
  defaultModel: string;
  initial: RoutineSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("routine");
  const { routines, refresh } = useRoutines(projectId, initial);
  const [detail, setDetail] = useState<Routine | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const go = (routine: string | null) => {
    const q = new URLSearchParams(params.toString());
    q.set("building", "workshop");
    if (routine) q.set("routine", routine);
    else q.delete("routine");
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  // The list carries everything the form needs, but fetch the full routine for a deep link before the list loads.
  const fromList = routines?.find((r) => r.id === selected) ?? null;
  useEffect(() => {
    if (!selected || selected === "new" || fromList) return;
    let alive = true;
    api.getRoutine(selected).then((r) => alive && setDetail(r.routine), () => alive && setDetail(null));
    return () => { alive = false; };
  }, [selected, fromList]);
  const current: Routine | null = fromList ?? (detail?.id === selected ? detail : null);

  const list = routines ?? [];
  const onSaved = (r: Routine) => {
    void refresh();
    setHistoryKey((k) => k + 1);
    go(r.id);
  };

  if (selected === "new")
    return (
      <Section title="New routine">
        <RoutineForm projectId={projectId} repo={repo} hasRemote={hasRemote} workspaces={workspaces} defaultModel={defaultModel} onSaved={onSaved} onCancel={() => go(null)} />
      </Section>
    );

  if (selected && current) {
    const summary = routines?.find((r) => r.id === current.id);
    return (
      <>
        <Section
          title="Runs"
          actions={summary && <RunNowButton routine={summary} onStarted={() => { void refresh(); setHistoryKey((k) => k + 1); }} />}
        >
          <p className="text-muted-foreground mb-2 text-[11px]">{triggerSummary(current)}</p>
          <RunHistory routineId={current.id} projectId={projectId} refreshKey={historyKey} />
        </Section>
        <Section title="Standing order">
          <RoutineForm
            key={current.id}
            projectId={projectId}
            repo={repo}
            hasRemote={hasRemote}
            workspaces={workspaces}
            defaultModel={defaultModel}
            routine={current}
            onSaved={onSaved}
            onCancel={() => go(null)}
          />
        </Section>
      </>
    );
  }

  return (
    <Section
      title={`Standing orders${list.length ? ` (${list.length})` : ""}`}
      actions={
        <Button size="xs" onClick={() => go("new")}>
          <PlusIcon /> New routine
        </Button>
      }
    >
      {routines === null ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : list.length === 0 ? (
        <div className="text-muted-foreground flex flex-col gap-2 py-2 text-xs leading-relaxed">
          <p>No routines yet. A routine is a prompt the workshop sends to an agent on a schedule, on demand, or when something happens: a new pull request, a failing Run script, a local webhook.</p>
          <p>Each run gets its own session (a fresh worktree by default), and its report lands in the Library.</p>
        </div>
      ) : (
        <RoutineList routines={list} selectedId={selected} onSelect={go} onChange={() => void refresh()} />
      )}
    </Section>
  );
}
