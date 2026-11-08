import { noteItem } from "@/lib/notes/routes";
export const dynamic = "force-dynamic";
export const { GET, PATCH, DELETE } = noteItem("repos");
