import { getProjectBySlug } from "@/lib/db/repo/projects";
import { redirect } from "next/navigation";
import { TownPage } from "@/components/town/town-page";
import { PROJECT_SECTIONS, projectSectionPath } from "@/lib/routes";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[project]">) {
  const { project: slug } = await params;
  const project = await getProjectBySlug(slug).catch(() => null);
  return { title: project ? `${project.name} · Thunk` : "Thunk" };
}

export default async function ProjectPage(props: PageProps<"/[project]">) {
  const query = await props.searchParams;
  const building = query.building;
  if (typeof building === "string" && Object.hasOwn(PROJECT_SECTIONS, building) && !query.ws && !query.session) {
    const rest = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === "building") continue;
      for (const v of Array.isArray(value) ? value : value ? [value] : []) rest.append(key, v);
    }
    const { project } = await props.params;
    redirect(`${projectSectionPath(`/${project}`, building as keyof typeof PROJECT_SECTIONS)}${rest.size ? `?${rest}` : ""}`);
  }
  return <TownPage {...props} />;
}
