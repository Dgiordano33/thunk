import { noteTasks } from "@/lib/notes/routes";

export const dynamic = "force-dynamic";

const h = noteTasks("workspaces");
export const GET = h.GET;

