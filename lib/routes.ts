// Page URLs. Shared between server and client: keep free of server-only imports.
//
//   /projects                               world map
//   /{project}                              town (session/workspace previews via query)
//   /{project}/{workspace}                  workspace → its latest session
//   /{project}/{workspace}/new              new chat
//   /{project}/{workspace}/{sessionId}      session
//   /{project}/{workspace}/file/{path}     a workspace file (optional ?root=)
//   /{project}/canvas[/{boardId}]          a canvas (optional ?card=)
//   /projects/{project}/{section}          project screens

/** Top-level paths a project slug may never take: app pages, legacy redirects and framework paths. */
export const RESERVED_SLUGS: readonly string[] = ["projects", "inbox", "notes", "routines", "vault", "settings", "mock", "api", "p", "w", "s", "new", "_next"];

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
  const query = new URLSearchParams(root ? { root } : {});
  if (tab) query.set("tab", tab);
  return `${base}/file/${path.split("/").map(encodeURIComponent).join("/")}${query.size ? `?${query}` : ""}`;
}

export function sessionPath(project: Slugged, workspace: Slugged, sessionId: string) {
  return `${workspacePath(project, workspace)}/${sessionId}`;
}

/** Whether `pathname` is a project's town, or anything under it. */
export function isProjectPath(pathname: string) {
  return projectSlugFromPath(pathname) !== null;
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
    /** The project a workspace belongs to, when the tree has it. */
    projectOf: (workspaceId: string) => projects.find((p) => p.workspaces.some((w) => w.id === workspaceId))?.id ?? null,
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

export const RESERVED_WORKSPACE_SLUGS = ["canvas"];
/** A canvas: `/{project}/canvas` is the main one, `/{project}/canvas/{boardId}` the others. `card` centres and focuses that card. */
export const canvasPath = (project: Slugged, boardId?: string, card?: string) =>
  `/${project.slug}/canvas${boardId && boardId !== "main" ? `/${encodeURIComponent(boardId)}` : ""}${card ? `?card=${encodeURIComponent(card)}` : ""}`;

/**
 * Reads a canvas URL: the board it shows, or where to send it instead. Old links named the board in
 * `?session=`; `/canvas/main` is spelled `/canvas`. Null when the URL names no canvas.
 */
export function resolveCanvasUrl(project: Slugged, segments: string[] | undefined, session: string | undefined, card?: string): { boardId: string } | { redirect: string } | null {
  if (segments && segments.length > 1) return null;
  const named = segments?.[0];
  if (session !== undefined) return named ? null : { redirect: canvasPath(project, session, card) };
  if (named === "main") return { redirect: canvasPath(project, "main", card) };
  return { boardId: named ?? "main" };
}

/** Read the editor path once, preserving literal percent signs and encoded filename characters. */
export function filePathFromUrl(base: string, pathname: string) {
  const prefix = `${base}/file/`;
  if (!pathname.startsWith(prefix)) return null;
  try { return pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/"); }
  catch { return null; }
}

export const PROJECT_SECTIONS = { center: "settings", library: "notes", workshop: "routines", tasks: "tasks", vault: "vault" } as const;

export function projectSectionPath(base: string, building: keyof typeof PROJECT_SECTIONS, params: Record<string, string> = {}) {
  const legacy = base.startsWith("/p/");
  const query = new URLSearchParams(legacy ? { ...params, building } : params);
  const path = legacy ? base : `/projects${base}/${PROJECT_SECTIONS[building]}`;
  return `${path}${query.size ? `?${query}` : ""}`;
}

/** Both the town/workspace URLs and project screens identify the same project. */
export function projectSlugFromPath(pathname: string) {
  const [, first, second] = pathname.split("/");
  if (first === "projects" && second) return second;
  return first && !RESERVED_SLUGS.includes(first) ? first : null;
}
