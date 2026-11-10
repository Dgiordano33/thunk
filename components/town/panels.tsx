import { ChiefPanel } from "@/components/project/chief-panel";
// Panel bodies for the town view. Server components; the interactive parts are existing client components.
import { ArchiveIcon, ExternalLinkIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { ExternalSessions } from "@/components/project/external-sessions";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import { ProjectRepos } from "@/components/project/project-repos";
import { SessionView } from "@/components/session/session-view";
import { relativeTime, workspaceLabel } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { HarvestButton } from "@/components/workspace/harvest-dialog";
import { WorkspaceMenu } from "@/components/workspace/workspace-menu";
import { WorkspaceBaseProvider } from "@/components/workspace/route-context";
import { newChatPath, projectPath, workspacePath } from "@/lib/routes";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import type { PersistedDocument } from "@/lib/documents/types";
import type { ExternalSession } from "@/lib/projects";
import type { Project, WorkspaceSummary } from "@/lib/projects/types";
import { LEVEL_NAMES, type CityLevel } from "@/lib/world/cities";
import { CROP_NAMES } from "@/lib/world/town";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";
import { WorkspaceDirectory } from "@/components/workspace/workspace-directory";
import { DeliveryPanel } from "./delivery-panel";
import { ProjectSettings } from "./project-settings";
import { TownNotes } from "./town-notes";
import { PanelTabs, type PanelTab } from "./panel-tabs";
import { TownPanel } from "./town-panel";
import type { TownField } from "./town-view";

const usd = (n: number) => `$${n.toFixed(2)}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-4 last:border-b-0">
      <h3 className="pixel mb-2 text-sm">{title}</h3>
      {children}
    </section>
  );
}

function Pane({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-4">{children}</div>;
}

function Count({ n }: { n: number }) {
  return <span className="text-muted-foreground tabular-nums">{n}</span>;
}

function Stats({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The project has one civic center, independent of its workspaces. */
export function ProjectPanel({ project, level, allFarmCount, totalSpend, activeCount, archived, externalSessions, workspaces, closeHref }: {
  project: Project; level: CityLevel; allFarmCount: number; totalSpend: number; activeCount: number;
  archived: WorkspaceSummary[]; externalSessions: ExternalSession[]; workspaces: WorkspaceSummary[]; closeHref: string;
}) {
  const tabs: PanelTab[] = [
    { value: "chief", label: "Chief", content: <Pane><ChiefPanel projectId={project.id} /></Pane> },
    {
      value: "overview",
      label: "Overview",
      content: <>
        <Section title="Project">
          <Stats
            rows={[
              ["Rank", `${LEVEL_NAMES[level - 1]} (level ${level})`],
              ["Workspaces", activeCount],
              ["Sessions", allFarmCount],
              ["Total spend", usd(totalSpend)],
              ["Founded", relativeTime(project.createdAt)],
            ]}
          />
          <div className="mt-3">
            <NewWorkspaceButton projectId={project.id} projectSlug={project.slug} projectName={project.name} repos={project.repos} />
          </div>
        </Section>
        <Section title={`Repos (${project.repos.length})`}>
          <ProjectRepos project={project} />
          {project.repos.length === 0 && workspaces.filter((w) => w.slug === "main").map((w) => <WorkspaceDirectory key={w.id} id={w.id} cwd={w.cwd} />)}
        </Section>
      </>,
    },
    { value: "notes", label: "Notes", content: <Pane><TownNotes townHref={projectPath(project)} scope={{ kind: "projects", id: project.id }} /></Pane> },
  ];
  if (externalSessions.length > 0) tabs.push({
    value: "settlers",
    label: <>Settlers <Count n={externalSessions.length} /></>,
    content: <Pane><ExternalSessions projectSlug={project.slug} sessions={externalSessions} workspaces={workspaces} /></Pane>,
  });
  if (archived.length > 0) tabs.push({
    value: "archived",
    label: <>Archived <Count n={archived.length} /></>,
    content: <Pane>
      <ul className="flex flex-col">
        {archived.map((w) => (
          <li key={w.id}>
            <Link href={workspacePath(project, w)} className="text-muted-foreground hover:bg-muted flex items-center gap-2 px-1 py-1 text-xs">
              <ArchiveIcon className="size-3" /> {workspaceLabel(w)}
            </Link>
            <WorkspaceMenu project={project} workspace={w} label={workspaceLabel(w)} />
          </li>
        ))}
      </ul>
    </Pane>,
  });
  tabs.push({ value: "settings", label: "Settings", content: <Pane><ProjectSettings id={project.id} name={project.name} /></Pane> });

  return <TownPanel eyebrow="Project" title={project.name} closeHref={closeHref} medium>
    <PanelTabs tabs={tabs} />
  </TownPanel>;
}

export function FarmPanel({ project, workspace, fields, closeHref }: {
  project: Project; workspace: WorkspaceSummary; fields: TownField[]; closeHref: string;
}) {
  const label = workspaceLabel(workspace);
  const base = projectPath(project);
  return <TownPanel eyebrow="Workspace" title={label} closeHref={closeHref} actions={<>
    <HarvestButton workspaceId={workspace.id} label={label} variant="ghost" />
    <WorkspaceMenu project={project} workspace={workspace} label={label} openLink />
  </>}>
      <Section title="Workspace">
        <WorkspaceDirectory id={workspace.id} cwd={workspace.cwd} />
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {workspace.branch ? (
            <span className="flex items-center gap-1 font-mono"><GitBranchIcon className="size-3" />{workspace.branch}</span>
          ) : (
            <span className="text-muted-foreground">{workspace.repos.length ? "In place in its repos" : "In the project's scratch folder"}</span>
          )}
        </div>
        {workspace.repos.length > 1 && (
          <ul className="text-muted-foreground mb-3 flex flex-col gap-0.5 text-xs">
            {workspace.repos.map((r) => (
              <li key={r.repoId} className="flex items-center gap-1.5" title={r.cwd}>
                <span className="text-foreground font-medium">{r.name}</span>
                {r.worktreePath ? <span className="flex items-center gap-1 font-mono"><GitBranchIcon className="size-3" />{r.branch}</span> : <span>in place</span>}
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" asChild>
          <Link href={newChatPath(project, workspace)}><PlusIcon /> New session</Link>
        </Button>
      </Section>

      {workspaceRepoTargets({ project, workspace }).length > 0 && <Section title="Delivery">
        <DeliveryPanel key={workspace.id} workspaceId={workspace.id} />
      </Section>}

      <Section title={`Sessions (${fields.length})`}>
        {fields.length === 0 ? (
          <p className="text-muted-foreground text-xs">No sessions yet.</p>
        ) : (
          <ul className="flex flex-col">
            {fields.map((f) => (
              <li key={f.id}>
                <Link href={`${base}?session=${f.id}`} scroll={false} className={`hover:bg-muted flex items-center gap-2 px-1 py-1 text-xs ${f.fallow ? "opacity-50" : ""}`}>
                  <span className="min-w-0 flex-1 truncate">{f.title || "Untitled session"}</span>
                  <span className="text-muted-foreground shrink-0">{f.fallow ? "Fallow" : CROP_NAMES[f.stage]} · {relativeTime(f.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Notes">
        <TownNotes townHref={projectPath(project)} scope={{ kind: "workspaces", id: workspace.id }} />
      </Section>

    </TownPanel>;
}

/** A field opens straight into its chat. */
export function FieldPanel({
  meta,
  events,
  documents,
  workspaceName,
  workspaceHref,
  closeHref,
}: {
  meta: SessionMeta;
  events: HarnessEvent[];
  documents: PersistedDocument[];
  workspaceName: string;
  /** The session's workspace page, `/{project}/{workspace}`. */
  workspaceHref: string;
  closeHref: string;
}) {
  return (
    <TownPanel
      eyebrow={`Session · ${workspaceName}${meta.origin?.kind === "routine" ? " · Routine" : meta.origin?.kind === "chief" ? " · Chief" : meta.origin?.kind === "worker" ? " · Worker" : ""}`}
      title={meta.title || "Untitled session"}
      closeHref={closeHref}
      wide
      escapable={false}
      actions={
        <Button size="sm" variant="ghost" className="text-xs" asChild>
          <Link href={`${workspaceHref}/${meta.id}`}><ExternalLinkIcon /> Full view</Link>
        </Button>
      }
    >
      {/* SessionView manages its own scroll; give it the panel's full height. */}
      <div className="h-full">
        <WorkspaceBaseProvider value={workspaceHref}>
          <SessionView key={meta.id} meta={meta} events={events} documents={documents} />
        </WorkspaceBaseProvider>
      </div>
    </TownPanel>
  );
}
