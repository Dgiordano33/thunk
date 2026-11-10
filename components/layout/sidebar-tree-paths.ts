import type { SidebarProject } from "./app-sidebar";

/** Just the ids and slugs of a project tree: what PathsProvider needs to build URLs. */
export function pathTree(projects: SidebarProject[]) {
  return projects.map((p) => ({ id: p.id, slug: p.slug, workspaces: p.workspaces.map((w) => ({ id: w.id, slug: w.slug })) }));
}
