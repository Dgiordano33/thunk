import { notesCollection } from "@/lib/notes/routes";
export const dynamic = "force-dynamic";
export const { GET, POST } = notesCollection("repos");
