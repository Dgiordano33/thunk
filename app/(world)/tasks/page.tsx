import { TasksOverview } from "@/components/tasks/tasks-overview";
import { listProjects } from "@/lib/db/repo/projects";

export const metadata = { title: "Tasks · Thunk" };
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const projects = await listProjects();
  return <TasksOverview projects={projects.map(({ id, name }) => ({ id, name }))} />;
}
