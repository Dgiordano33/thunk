import { cn } from "@/lib/utils";

/** Shared surface: ruled glass in Solar, an opaque bordered card in Vanilla. `parchment` marks an empty state. */
export function CivPanel({
  className,
  bodyClassName,
  parchment,
  children,
  ...props
}: React.ComponentProps<"div"> & { bodyClassName?: string; parchment?: boolean }) {
  return (
    <div className={cn("civ-panel", parchment && "is-parchment", className)} {...props}>
      <div className={cn("civ-panel-body", bodyClassName)}>{children}</div>
    </div>
  );
}
