"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type PanelTab = {
  value: string;
  label: React.ReactNode;
  /** Shown instead of the label in a vertical rail. */
  icon?: React.ReactNode;
  /** Plain-text name for the icon's tooltip and accessible name. */
  name?: string;
  /** A count shown on the rail icon, like sessions or external sessions. Hidden at zero. */
  count?: number;
  content: React.ReactNode;
};

/** Section nav for a town panel: a row of labels, or with `vertical` a rail of icons down the left. The active tab lives in `?section=` so reloads and links keep it. */
export function PanelTabs({ tabs, vertical }: { tabs: PanelTab[]; vertical?: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("section");
  // Switch immediately without waiting for the router, and follow later URL changes.
  const [selection, setSelection] = useState({ requested, value: requested });
  if (selection.requested !== requested) {
    setSelection({ requested, value: requested });
  }
  const value = tabs.some((t) => t.value === selection.value) ? selection.value! : tabs[0]?.value;
  const onValueChange = (next: string) => {
    setSelection({ requested, value: next });
    const query = new URLSearchParams(params.toString());
    query.set("section", next);
    window.history.replaceState(null, "", `${pathname}?${query}`);
  };
  const panes = tabs.map((t) => (
    <TabsContent key={t.value} value={t.value} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {t.content}
    </TabsContent>
  ));

  if (vertical) return (
    <Tabs value={value} onValueChange={onValueChange} orientation="vertical" className="h-full gap-0">
      <div className="shrink-0 overflow-y-auto border-r px-1 py-2">
        <TabsList variant="line">
          {tabs.map((t) => (
            // The tooltip takes over `data-state`, so the active style keys off `aria-selected`.
            <Tooltip key={t.value}>
              <TooltipTrigger asChild>
                <TabsTrigger value={t.value} aria-label={t.name} className="size-11 flex-none justify-center md:size-9 group-data-vertical/tabs:justify-center aria-selected:bg-muted aria-selected:text-foreground aria-selected:after:opacity-100">
                  {t.icon ?? t.label}
                  {!!t.count && (
                    <span aria-hidden className="bg-popover text-muted-foreground ring-border absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 font-mono text-[9px] leading-4 tabular-nums ring-1">
                      {t.count > 99 ? "99+" : t.count}
                    </span>
                  )}
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{t.name ?? t.label}{t.count ? ` · ${t.count}` : ""}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </div>
      {panes}
    </Tabs>
  );

  return (
    <Tabs value={value} onValueChange={onValueChange} className="flex h-full flex-col gap-0">
      <div className="flex h-10 shrink-0 items-end overflow-x-auto border-b px-2">
        <TabsList variant="line" className="h-full">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="pixel text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {panes}
    </Tabs>
  );
}
