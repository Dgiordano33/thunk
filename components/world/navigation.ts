import { SETTINGS_PATH, settingsSection } from "@/components/settings/sections";
import { PROJECTS_PATH, projectPath, projectSlugFromPath } from "@/lib/routes";

export type WorldCrumb = { label: string; href: string };

const sectionLabels: Record<string, string> = {
  settings: "Settings",
  inbox: "Inbox",
  notes: "Notes",
  routines: "Routines",
  vault: "Vault",
  tasks: "Tasks",
};

/** Explicit parents keep navigation useful even when a page is opened directly. */
export function worldBreadcrumbs(pathname: string, projects: { slug: string; name: string }[], world = false): WorldCrumb[] {
  const crumbs: WorldCrumb[] = [{ label: world ? "World" : "Projects", href: PROJECTS_PATH }];
  const [, first, , section] = pathname.split("/");
  const slug = projectSlugFromPath(pathname);
  if (slug) {
    const project = projects.find((p) => p.slug === slug);
    crumbs.push({ label: project?.name ?? "Project", href: projectPath({ slug }) });
    if (first === "projects" && sectionLabels[section]) {
      crumbs.push({ label: sectionLabels[section], href: pathname });
    }
  } else if (sectionLabels[first]) {
    crumbs.push({ label: sectionLabels[first], href: `/${first}` });
    if (first === "settings" && pathname !== SETTINGS_PATH) {
      const setting = settingsSection(pathname.split("/")[2] ?? "");
      if (setting) crumbs.push({ label: setting.label, href: pathname });
    }
  }
  return crumbs;
}
