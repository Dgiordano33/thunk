"use client";

import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A tooltip on hover and keyboard focus, with an optional key hint: use it in place of `title` for icon buttons,
 * status marks and actions. A plain `title` is still right for the full text of a truncated name.
 */
export function Hint({ label, keys, side = "top", children }: {
  label: React.ReactNode;
  /** A shortcut that does the same thing, like "⌘S". */
  keys?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-72">
        {label}
        {keys && <Kbd className="ml-1.5">{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
