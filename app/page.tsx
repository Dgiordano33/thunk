import { redirect } from "next/navigation";
import { PROJECTS_PATH } from "@/lib/routes";

// The world map lives at /projects.
export default function Root() {
  redirect(PROJECTS_PATH);
}
