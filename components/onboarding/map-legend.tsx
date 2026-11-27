"use client";
import { useOnboarding } from "./provider";
import { Hierarchy, MapMark } from "./intro";
import { Button } from "@/components/ui/button";
export function MapLegend() {
  const { seen, markSeen } = useOnboarding();
  if (seen("map-legend")) return null;
  return <aside aria-label="Map legend" className="absolute bottom-20 left-4 z-20 w-56 rounded-lg border bg-background/95 p-3 shadow-sm"><div className="mb-2 flex items-center justify-between text-sm"><strong>Map legend</strong><Button variant="ghost" size="xs" onClick={() => markSeen("map-legend")} aria-label="Dismiss map legend">Dismiss</Button></div><Hierarchy /><p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><MapMark level={2} closed />Closed session · hollow</p></aside>;
}
