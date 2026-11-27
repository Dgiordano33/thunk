import { ArchiveIcon, BellIcon, SettingsIcon, ListChecksIcon, NotebookTextIcon, OrbitIcon, PenLineIcon, RepeatIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Historical icon names shared by existing callers. */
export type PixelIconName = "bell" | "gear" | "checklist" | "castle" | "scroll" | "quill" | "hourglass" | "chest";

/** Line icons shared by both supported looks. */
export const PLAIN_ICONS: Record<PixelIconName, LucideIcon> = {
  bell: BellIcon,
  gear: SettingsIcon,
  checklist: ListChecksIcon,
  castle: OrbitIcon,
  scroll: NotebookTextIcon,
  quill: PenLineIcon,
  hourglass: RepeatIcon,
  chest: ArchiveIcon,
};

/** Shared line icons. The historical name is retained for existing callers. */
export function PixelIcon({ name, className }: { name: PixelIconName; className?: string }) {
  const Plain = PLAIN_ICONS[name];
  return <Plain aria-hidden="true" strokeWidth={1.5} className={cn("text-muted-foreground", className)} />;
}
