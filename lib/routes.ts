// Page URLs. Shared between server and client: keep free of server-only imports.
//
//   /projects                               world map
//   /{project}                              town (panels via ?building=, ?session=, ?ws=…)
//   /{project}/{workspace}                  workspace → its latest session
//   /{project}/{workspace}/new              new chat
//   /{project}/{workspace}/{sessionId}      session
//   /{project}/{workspace}/file?root=&path= a workspace file in the editor

/** Top-level paths a project slug may never take: app pages, legacy redirects and framework paths. */
export const RESERVED_SLUGS: readonly string[] = ["projects", "inbox", "notes", "routines", "vault", "mock", "api", "p", "w", "s", "new", "_next"];

type Slugged = { slug: string };

/** The URL slug for a project name, before de-duplication. Matches the backfill in migration 0011. */
export function projectUrlSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "") || "project";
}

/** The first `${base}`, `${base}-2`, … that isn't reserved and that `taken` rejects. */
export async function freshSlug(base: string, taken: (slug: string) => boolean | Promise<boolean>) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!RESERVED_SLUGS.includes(slug) && !(await taken(slug))) return slug;
  }
}

export const PROJECTS_PATH = "/projects";

export function projectPath(project: Slugged) {
  return `/${project.slug}`;
}

export function workspacePath(project: Slugged, workspace: Slugged) {
  return `/${project.slug}/${workspace.slug}`;
}

export function newChatPath(project: Slugged, workspace: Slugged) {
  return `${workspacePath(project, workspace)}/new`;
}

/**
 * A workspace file open in the editor. `base` is the workspace page URL; without `root`, the primary repo.
 * `tab` keeps the right panel on the tab it was showing.
 */
export function filePagePath(base: string, root: string | null, path: string, tab?: string | null) {
  const query = new URLSearchParams(root ? { root, path } : { path });
  if (tab) query.set("tab", tab);
  return `${base}/file?${query}`;
}

export function sessionPath(project: Slugged, workspace: Slugged, sessionId: string) {
  return `${workspacePath(project, workspace)}/${sessionId}`;
}

/** Whether `pathname` is a project's town, or anything under it. */
export function isProjectPath(pathname: string) {
  const first = pathname.split("/")[1];
  return !!first && !RESERVED_SLUGS.includes(first);
}

type ProjectTree = { id: string; slug: string; workspaces: { id: string; slug: string }[] };

/**
 * Page URLs by id, for client code that holds the project list. An id it doesn't know (an archived or
 * deleted workspace) falls back to the legacy id URL, which redirects or 404s.
 */
export function pathsFor(projects: ProjectTree[]) {
  const workspace = (workspaceId: string) => {
    for (const p of projects) {
      const w = p.workspaces.find((w) => w.id === workspaceId);
      if (w) return workspacePath(p, w);
    }
    return null;
  };
  return {
    project: (projectId: string) => {
      const p = projects.find((p) => p.id === projectId);
      return p ? projectPath(p) : `/p/${projectId}`;
    },
    workspace: (workspaceId: string) => workspace(workspaceId) ?? `/w/${workspaceId}`,
    session: (workspaceId: string, sessionId: string) => {
      const base = workspace(workspaceId);
      return base ? `${base}/${sessionId}` : `/w/${workspaceId}/s/${sessionId}`;
    },
  };
}
