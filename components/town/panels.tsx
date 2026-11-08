// Panel bodies for the town view. Server components; the interactive parts are existing client components.
import { ArchiveIcon, ExternalLinkIcon, GitBranchIcon, SproutIcon } from "lucide-react";
import Link from "next/link";
import { ExternalSessions } from "@/components/project/external-sessions";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import { ProjectRepos } from "@/components/project/project-repos";
import { SessionView } from "@/components/session/session-view";
import { relativeTime, workspaceLabel } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { WorkspaceMenu } from "@/components/workspace/workspace-menu";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import type { PersistedDocument } from "@/lib/documents/types";
import type { ExternalSession } from "@/lib/projects";
import type { Project, WorkspaceSummary } from "@/lib/projects/types";
import { LEVEL_NAMES, type CityLevel } from "@/lib/world/cities";
import { CROP_NAMES } from "@/lib/world/town";
import { DeliveryPanel } from "./delivery-panel";
import { ProjectSettings } from "./project-settings";
import { TownNotes } from "./town-notes";
import { TownPanel } from "./town-panel";
import type { TownFarm } from "./town-view";

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const usd = (n: number) => `$${n.toFixed(2)}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-4 last:border-b-0">
      <h3 className="pixel mb-2 text-sm">{title}</h3>
      {children}
    </section>
  );
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

/** A town center: its workspace, and for the capital, the whole project. */
export function TownCenterPanel({
  project,
  workspace,
  capital,
  level,
  farms,
  allFarmCount,
  totalSpend,
  activeCount,
  archived,
  externalSessions,
  workspaces,
  closeHref,
}: {
  project: Project;
  workspace: WorkspaceSummary;
  capital: boolean;
  level: CityLevel;
  farms: TownFarm[];
  allFarmCount: number;
  totalSpend: number;
  activeCount: number;
  archived: WorkspaceSummary[];
  externalSessions: ExternalSession[];
  workspaces: WorkspaceSummary[];
  closeHref: string;
}) {
  const label = workspaceLabel(workspace);
  const base = `/p/${project.id}`;
  return (
    <TownPanel
      eyebrow={capital ? "Capital · town center" : "Town center"}
      title={capital ? project.name : label}
      closeHref={closeHref}
      actions={!capital && <WorkspaceMenu workspace={workspace} label={label} />}
    >
      {capital && (
        <Section title="Project">
          <p className="text-muted-foreground mb-3 truncate font-mono text-[11px]">{tildify(project.root)}</p>
          <Stats
            rows={[
              ["Rank", `${LEVEL_NAMES[level - 1]} (level ${level})`],
              ["Kind", project.kind],
              ...(project.remote ? ([["Remote", project.remote]] as [string, React.ReactNode][]) : []),
              ...(project.defaultBranch ? ([["Default branch", project.defaultBranch]] as [string, React.ReactNode][]) : []),
              ["Town centers", activeCount],
              ["Fields", allFarmCount],
              ["Total spend", usd(totalSpend)],
              ["Founded", relativeTime(project.createdAt)],
            ]}
          />
          <div className="mt-3">
            <NewWorkspaceButton projectId={project.id} projectName={project.name} repos={project.extraRepos} />
          </div>
        </Section>
      )}

      {capital && (
        <Section title={`Repos (${project.extraRepos.length + (project.kind === "repo" ? 1 : 0)})`}>
          <ProjectRepos project={project} />
        </Section>
      )}

      <Section title={capital ? `Workspace · ${label}` : "Workspace"}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {workspace.worktreePath ? (
            <span className="flex items-center gap-1 font-mono"><GitBranchIcon className="size-3" />{workspace.branch}</span>
          ) : (
            <span className="text-muted-foreground">In place at the project root</span>
          )}
        </div>
        {workspace.extraRepos.length > 0 && (
          <ul className="text-muted-foreground mb-3 flex flex-col gap-0.5 text-xs">
            {workspace.extraRepos.map((r) => (
              <li key={r.repoId} className="flex items-center gap-1.5" title={r.cwd}>
                <span className="text-foreground font-medium">{r.name}</span>
                {r.worktreePath ? <span className="flex items-center gap-1 font-mono"><GitBranchIcon className="size-3" />{r.branch}</span> : <span>in place</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <Link href={`/w/${workspace.id}/new`}><SproutIcon /> Sow a new field</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/w/${workspace.id}`}><ExternalLinkIcon /> Open workspace</Link>
          </Button>
        </div>
      </Section>

      <Section title="Delivery">
        <DeliveryPanel key={workspace.id} workspaceId={workspace.id} />
      </Section>

      <Section title={`Fields (${farms.length})`}>
        {farms.length === 0 ? (
          <p className="text-muted-foreground text-xs">No sessions yet. Sow a field to start one.</p>
        ) : (
          <ul className="flex flex-col">
            {farms.map((f) => (
              <li key={f.id}>
                <Link href={`${base}?session=${f.id}`} scroll={false} className="hover:bg-muted flex items-center gap-2 px-1 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate">{f.title || "Untitled session"}</span>
                  <span className="text-muted-foreground shrink-0">{CROP_NAMES[f.stage]} · {relativeTime(f.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={capital ? "Workspace notes" : "Notes"}>
        <TownNotes projectId={project.id} scope={{ kind: "workspaces", id: workspace.id }} />
      </Section>

      {capital && (
        <>
          <Section title="Project notes">
            <TownNotes projectId={project.id} scope={{ kind: "projects", id: project.id }} />
          </Section>
          {archived.length > 0 && (
            <Section title="Ruins (archived workspaces)">
              <ul className="flex flex-col">
                {archived.map((w) => (
                  <li key={w.id}>
                    <Link href={`/w/${w.id}`} className="text-muted-foreground hover:bg-muted flex items-center gap-2 px-1 py-1 text-xs">
                      <ArchiveIcon className="size-3" /> {workspaceLabel(w)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {externalSessions.length > 0 && (
            <Section title="Wandering settlers">
              <ExternalSessions sessions={externalSessions} workspaces={workspaces} />
            </Section>
          )}
          <Section title="Settings">
            <ProjectSettings id={project.id} name={project.name} />
          </Section>
        </>
      )}
    </TownPanel>
  );
}

/** A field opens straight into its chat. */
export function FieldPanel({
  meta,
  events,
  documents,
  workspaceName,
  closeHref,
}: {
  meta: SessionMeta;
  events: HarnessEvent[];
  documents: PersistedDocument[];
  workspaceName: string;
  closeHref: string;
}) {
  return (
    <TownPanel
      eyebrow={`Field · ${workspaceName}${meta.origin?.kind === "routine" ? " · Routine" : ""}`}
      title={meta.title || "Untitled session"}
      closeHref={closeHref}
      wide
      escapable={false}
      actions={
        <Button size="sm" variant="ghost" className="text-xs" asChild>
          <Link href={`/w/${meta.workspaceId}/s/${meta.id}`}><ExternalLinkIcon /> Full view</Link>
        </Button>
      }
    >
      {/* SessionView manages its own scroll; give it the panel's full height. */}
      <div className="h-full">
        <SessionView key={meta.id} meta={meta} events={events} documents={documents} />
      </div>
    </TownPanel>
  );
}
