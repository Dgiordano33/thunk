import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TasksPanel } from "@/components/town/tasks-panel";
import { LibraryPanel } from "@/components/town/library-panel";
import { FieldPanel, TownCenterPanel } from "@/components/town/panels";
import { WorkshopPanel } from "@/components/town/workshop-panel";
import { TownView, type TownFarm, type TownSelection, type TownWorkspace } from "@/components/town/town-view";
import { workspaceLabel } from "@/components/session/labels";
import { listSessions, liveMeta } from "@/lib/agent";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import type { PersistedDocument } from "@/lib/documents/types";
import { ensureMainWorkspace, listExternalSessions } from "@/lib/projects";
import { loadDocuments } from "@/lib/supabase/repo/documents";
import { loadEvents } from "@/lib/supabase/repo/messages";
import { getProject } from "@/lib/supabase/repo/projects";
import { getSessionRow, listSessionRows } from "@/lib/supabase/repo/sessions";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";
import { cityHue, cityLevel } from "@/lib/world/cities";
import { cropStage, layoutTown } from "@/lib/world/town";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const project = await getProject(id).catch(() => null);
  return { title: project ? `${project.name} · Thunk` : "Thunk" };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

// A project up close: workspaces are town centers, sessions are the fields around them.
// `?ws=`, `?session=` and `?building=` open the matching panel without moving the camera.
export default async function TownPage({ params, searchParams }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();
  await ensureMainWorkspace(project);

  const [workspaces, sessions, rows] = await Promise.all([
    listWorkspaces(id),
    listSessions({ projectId: id, limit: 500 }),
    listSessionRows({ projectId: id, limit: 500 }).catch(() => []),
  ]);
  const active = workspaces.filter((w) => w.status === "active");
  const archived = workspaces.filter((w) => w.status === "archived");
  const activeIds = new Set(active.map((w) => w.id));
  const townSessions = sessions.filter((s) => activeIds.has(s.workspaceId));
  const cost = new Map(rows.map((r) => [r.id, r.totalCostUsd]));
  const layout = layoutTown(id, active, townSessions);

  const townWorkspaces: TownWorkspace[] = layout.centers.flatMap(({ workspaceId, cell, capital }) => {
    const w = active.find((x) => x.id === workspaceId);
    if (!w) return [];
    return [{
      id: w.id,
      label: workspaceLabel(w),
      branch: w.worktreePath ? w.branch : null,
      capital,
      hue: capital ? cityHue(id) : cityHue(w.id),
      sessionCount: townSessions.filter((s) => s.workspaceId === w.id).length,
      overflow: layout.overflow[w.id] ?? 0,
      ...cell,
    }];
  });
  const farms: TownFarm[] = townSessions.flatMap((s) => {
    const cell = layout.farms[s.id];
    if (!cell) return [];
    const costUsd = cost.get(s.id) ?? 0;
    return [{ id: s.id, workspaceId: s.workspaceId, title: s.title ?? null, model: s.model, createdAt: s.createdAt, costUsd, stage: cropStage(costUsd), ...cell }];
  });

  const selected: TownSelection = {
    session: one(query.session),
    ws: one(query.ws),
    building: one(query.building) === "library" ? "library" : one(query.building) === "workshop" ? "workshop" : one(query.building) === "tasks" ? "tasks" : undefined,
    note: one(query.note),
  };
  const closeHref = `/p/${id}`;

  let panel: React.ReactNode = null;
  if (selected.session) {
    const sid = selected.session;
    let meta: SessionMeta | null = liveMeta(sid);
    if (!meta) {
      const row = await getSessionRow(sid).catch(() => null);
      if (row) meta = { ...row, live: false };
    }
    if (meta && meta.projectId === id) {
      // Persisted history first; the SSE stream replays anything newer by seq.
      const [events, documents] = await Promise.all([
        loadEvents(sid).catch((): HarnessEvent[] => []),
        loadDocuments(sid).catch((): PersistedDocument[] => []),
      ]);
      const ws = workspaces.find((w) => w.id === meta.workspaceId);
      panel = <FieldPanel meta={meta} events={events} documents={documents} workspaceName={ws ? workspaceLabel(ws) : ""} closeHref={closeHref} />;
    }
  } else if (selected.ws) {
    const workspace = active.find((w) => w.id === selected.ws);
    const center = layout.centers.find((c) => c.workspaceId === selected.ws);
    if (workspace && center) {
      const externalSessions = center.capital
        ? await listExternalSessions(project, { exclude: sessions.map((s) => s.sdkSessionId) }).catch(() => [])
        : [];
      panel = (
        <TownCenterPanel
          project={project}
          workspace={workspace}
          capital={center.capital}
          level={cityLevel({ workspaceCount: workspaces.length, sessionCount: sessions.length })}
          farms={farms.filter((f) => f.workspaceId === workspace.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
          allFarmCount={townSessions.length}
          totalSpend={rows.reduce((n, r) => n + r.totalCostUsd, 0)}
          activeCount={active.length}
          archived={archived}
          externalSessions={externalSessions}
          workspaces={workspaces}
          closeHref={closeHref}
        />
      );
    }
  } else if (selected.building === "library") {
    panel = (
      <Suspense>
        <LibraryPanel projectId={id} workspaces={active.map((w) => ({ id: w.id, label: workspaceLabel(w) }))} closeHref={closeHref} />
      </Suspense>
    );
  } else if (selected.building === "tasks") {
    panel = <TasksPanel project={project} workspaces={workspaces} closeHref={closeHref} />;
  } else if (selected.building === "workshop") {
    panel = <WorkshopPanel project={project} workspaces={workspaces} closeHref={closeHref} />;
  }

  return (
    <TownView
      projectId={id}
      projectName={project.name}
      grid={layout.grid}
      tiles={layout.tiles}
      workspaces={townWorkspaces}
      farms={farms}
      library={layout.library}
      workshop={layout.workshop}
      selected={selected}
    >
      {panel}
    </TownView>
  );
}
