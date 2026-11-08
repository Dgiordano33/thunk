import { notesCollection } from "@/lib/notes/routes";

export const dynamic = "force-dynamic";

const h = notesCollection("workspaces");
export const GET = h.GET;
export const POST = h.POST;

