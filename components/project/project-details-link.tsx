import { EllipsisIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { projectPath, projectSectionPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

export function ProjectDetailsLink({ project, className }: { project: { name: string; slug: string }; className?: string }) {
  return (
    <Link
      href={projectSectionPath(projectPath(project), "center")}
      scroll={false}
      draggable={false}
      aria-label={`${project.name} details`}
      title="Project details"
      className={cn("text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:ring-ring mt-1 flex h-6 w-8 items-center justify-center rounded-full outline-none focus-visible:ring-2", className)}
    >
      <EllipsisIcon className="size-4" aria-hidden="true" />
    </Link>
  );
}
