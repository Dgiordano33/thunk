"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PanelTab = { value: string; label: React.ReactNode; content: React.ReactNode };

/** Horizontal section nav for a town panel. The active tab lives in `?section=` so reloads and links keep it. */
export function PanelTabs({ tabs }: { tabs: PanelTab[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("section");
  const value = tabs.some((t) => t.value === requested) ? requested! : tabs[0]?.value;

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const query = new URLSearchParams(params.toString());
        query.set("section", next);
        router.replace(`${pathname}?${query}`, { scroll: false });
      }}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10 shrink-0 items-end overflow-x-auto border-b px-2">
        <TabsList variant="line" className="h-full">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="pixel text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="min-h-0 flex-1 overflow-y-auto">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
