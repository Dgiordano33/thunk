import { ArchivedHarvestOffer } from "@/components/workspace/harvest-dialog";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TasksPanel } from "@/components/town/tasks-panel";
import { LibraryPanel } from "@/components/town/library-panel";
import { FieldPanel, ProjectPanel, FarmPanel } from "@/components/town/panels";
import { WorkshopPanel } from "@/components/town/workshop-panel";
import { VaultPanel } from "@/components/vault/vault-panel";
import { vaultDirOf } from "@/lib/vault/dir";
import { listItems } from "@/lib/vault/store";
import { isBusy } from "@/lib/vault/types";
import { TownView, type TownField, type TownSelection, type TownFarmhouse } from "@/components/town/town-view";
import { workspaceLabel } from "@/components/session/labels";
import { listSessions, liveMeta } from "@/lib/agent";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import type { PersistedDocument } from "@/lib/documents/types";
import { ensureMainWorkspace, listExternalSessions } from "@/lib/projects";
import { loadDocuments } from "@/lib/supabase/repo/documents";
import { loadEvents } from "@/lib/supabase/repo/messages";
import { getProjectBySlug } from "@/lib/supabase/repo/projects";
import { projectPath, workspacePath } from "@/lib/routes";
import { getSessionRow, listSessionRows } from "@/lib/supabase/repo/sessions";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";
import { cityHue, cityLevel } from "@/lib/world/cities";
import { cropStage, layoutTown } from "@/lib/world/town";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[project]">) {
  const { project: slug } = await params;
  const project = await getProjectBySlug(slug).catch(() => null);
  return { title: project ? `${project.name} · Thunk` : "Thunk" };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const BUILDINGS = ["center", "library", "workshop", "tasks", "vault"] as const;

// A project up close: workspaces are farms, sessions are the fields around them.
// `?ws=`, `?session=` and `?building=` open the matching panel without moving the camera.
export default async function TownPage({ params, searchParams }: PageProps<"/[project]">) {
  const { project: slug } = await params;
  const query = await searchParams;
  const project = await getProjectBySlug(slug);
  if (!project) notFound();
  const id = project.id;
  await ensureMainWorkspace(project);

  const [workspaces, rows, vaultItems] = await Promise.all([
    listWorkspaces(id),
    listSessionRows({ projectId: id, limit: 500 }).catch((err) => {
      console.error("[thunk] list sessions failed", err);
      return [];
    }),
    listItems(vaultDirOf(project)).catch(() => []),
  ]);
  const sessions = await listSessions({ projectId: id, limit: 500 }, rows);
  const active = workspaces.filter((w) => w.status === "active");
  const archived = workspaces.filter((w) => w.status === "archived");
  const activeIds = new Set(active.map((w) => w.id));
  const townSessions = sessions.filter((s) => activeIds.has(s.workspaceId));
  const cost = new Map(rows.map((r) => [r.id, r.totalCostUsd]));
  const layout = layoutTown(id, active, townSessions);

  const townWorkspaces: TownFarmhouse[] = layout.farmhouses.flatMap(({ workspaceId, cell }) => {
    const w = active.find((x) => x.id === workspaceId);
    if (!w) return [];
    return [{
      id: w.id,
      label: workspaceLabel(w),
      branch: w.branch,
      hasGit: w.repos.some((r) => project.repos.some((p) => p.id === r.repoId && p.kind === "repo")),
      hue: cityHue(w.id),
      lastActivityAt: [...rows.filter(r => r.workspaceId === w.id).map(r => r.updatedAt), w.updatedAt].sort().at(-1)!,
      sessionCount: townSessions.filter((s) => s.workspaceId === w.id).length,
      overflow: layout.overflow[w.id] ?? 0,
      ...cell,
    }];
  });
  const fields: TownField[] = townSessions.map((s) => {
    // Overflow fields remain reachable in the panel; only placed fields are sent to the map.
    const cell = layout.fields[s.id] ?? layout.center;
    const costUsd = cost.get(s.id) ?? 0;
    return { id: s.id, workspaceId: s.workspaceId, title: s.title ?? null, model: s.model, createdAt: s.createdAt, costUsd, stage: cropStage(costUsd), fallow: s.status === "closed" || s.status === "error", ...cell };
  });

  const selected: TownSelection = {
    session: one(query.session),
    ws: one(query.ws),
    building: BUILDINGS.find((b) => b === one(query.building)),
    note: one(query.note),
  };
  const closeHref = projectPath(project);

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
      panel = <FieldPanel meta={meta} events={events} documents={documents} workspaceName={ws ? workspaceLabel(ws) : ""} workspaceHref={ws ? workspacePath(project, ws) : `/w/${meta.workspaceId}`} closeHref={closeHref} />;
    }
  } else if (selected.ws) {
    const workspace = active.find((w) => w.id === selected.ws);
    if (workspace) panel = <FarmPanel project={project} workspace={workspace} fields={fields.filter((f) => f.workspaceId === workspace.id).sort((a, b) => Number(a.fallow) - Number(b.fallow) || b.createdAt.localeCompare(a.createdAt))} closeHref={closeHref} />;
  } else if (selected.building === "center") {
    const externalSessions = await listExternalSessions(project, { exclude: sessions.map((s) => s.sdkSessionId) }).catch(() => []);
    panel = <ProjectPanel project={project} level={cityLevel({ workspaceCount: workspaces.length, sessionCount: sessions.length })} allFarmCount={townSessions.length} totalSpend={rows.reduce((n, r) => n + r.totalCostUsd, 0)} activeCount={active.length} archived={archived} externalSessions={externalSessions} workspaces={workspaces} closeHref={closeHref} />;
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
  } else if (selected.building === "vault") {
    panel = (
      <Suspense>
        <VaultPanel projectId={id} closeHref={closeHref} />
      </Suspense>
    );
  }

  return (
    <TownView
      projectId={id}
      townHref={closeHref}
      projectName={project.name}
      grid={layout.grid}
      tiles={layout.tiles}
      farms={townWorkspaces}
      fields={fields.filter(f => layout.fields[f.id])}
      center={layout.center}
      townHall={layout.townHall}
      studio={layout.studio}
      library={layout.library}
      workshop={layout.workshop}
      vault={{ ...layout.vault, busy: vaultItems.some(isBusy), failed: vaultItems.some((i) => i.status === "failed") }}
      selected={selected}
    >
      {panel}
      {archived.filter(w => w.id === one(query.harvest)).map(w => <ArchivedHarvestOffer key={w.id} workspaceId={w.id} label={workspaceLabel(w)} />)}
    </TownView>
  );
}
