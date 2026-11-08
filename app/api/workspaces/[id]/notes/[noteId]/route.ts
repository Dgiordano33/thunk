import { noteItem } from "@/lib/notes/routes";

export const dynamic = "force-dynamic";

const h = noteItem("workspaces");
export const GET = h.GET;
export const PATCH = h.PATCH;
export const DELETE = h.DELETE;

