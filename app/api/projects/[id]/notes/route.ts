import { notesCollection } from "@/lib/notes/routes";

export const dynamic = "force-dynamic";

const h = notesCollection("projects");
export const GET = h.GET;
export const POST = h.POST;

