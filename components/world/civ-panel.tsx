import { cn } from "@/lib/utils";

/** The bronze frame every HUD surface on the world map sits in. `parchment` swaps the body for an old-map paper look. */
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
