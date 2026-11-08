import { noteTasks } from "@/lib/notes/routes";

export const dynamic = "force-dynamic";

const h = noteTasks("projects");
export const GET = h.GET;

