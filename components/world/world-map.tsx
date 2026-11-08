"use client";

import { InfoIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAmbient } from "@/lib/store/ambient-store";
import { LEVEL_NAMES, LEVEL_THRESHOLDS, cityActivity, type WorldCity } from "@/lib/world/cities";
import { MAP_H, MAP_W, WORLD, type Tile } from "@/lib/world/terrain";
import { CivPanel } from "./civ-panel";
import { City } from "./city";
import { CONTROL_BUTTON, IsoViewport } from "./iso-viewport";
import { TerrainLayer } from "./terrain-layer";

export function WorldMap({ tiles, cities, children }: { tiles: Tile[][]; cities: WorldCity[]; children?: React.ReactNode }) {
  const sessions = useAmbient((s) => s.sessions);
  return (
    <IsoViewport
      width={MAP_W}
      height={MAP_H}
      label="World map"
      stage={
        <>
          <TerrainLayer tiles={tiles} grid={WORLD} borders={cities.map((c) => ({ id: c.project.id, hue: c.hue, cells: c.territory }))} />
          {cities.map((city) => (
            <City key={city.project.id} city={city} activity={cityActivity(sessions, city.project.id)} />
          ))}
        </>
      }
      controls={<LegendButton label="Map legend"><Legend /></LegendButton>}
    >
      <div aria-hidden="true" className="world-vignette pointer-events-none absolute inset-0 z-10" />
      {children}
    </IsoViewport>
  );
}

/** Info button in the zoom column that pops a legend out to the left. */
export function LegendButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label} className={CONTROL_BUTTON}>
          <InfoIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="end" className="w-auto rounded-none bg-transparent p-0 shadow-none ring-0" aria-label={label}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function Legend() {
  const ranges = LEVEL_NAMES.map((name, i) => {
    const lo = i === 0 ? 0 : LEVEL_THRESHOLDS[i - 1];
    const hi = LEVEL_THRESHOLDS[i];
    return { name, level: i + 1, range: hi === undefined ? `${lo}+` : lo === hi - 1 ? `${lo}` : `${lo}–${hi - 1}` };
  });
  return (
    <CivPanel className="pointer-events-auto w-52" bodyClassName="px-3 py-2">
      <p className="pixel text-sm">Legend</p>
      <p className="text-muted-foreground mb-1.5 text-[11px]">Population = workspaces × 2 + sessions</p>
      <ul className="grid gap-0.5 text-xs">
        {ranges.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="pixel bg-foreground/80 text-background flex size-4 items-center justify-center text-[10px]">{r.level}</span>
            <span>{r.name}</span>
            <span className="text-muted-foreground ml-auto tabular-nums">{r.range}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-2 grid gap-0.5 border-t pt-1.5 text-xs">
        <li className="flex items-center gap-2"><span className="size-2 bg-[oklch(0.92_0_0)] ring-1 ring-black/30" /> Smoke: session running</li>
        <li className="flex items-center gap-2"><span className="pixel flex size-3 items-center justify-center bg-[oklch(0.86_0.17_90)] text-[9px] text-black">!</span> Needs attention</li>
        <li className="flex items-center gap-2"><span className="pixel text-muted-foreground text-[10px]">zzz</span> Dormant 30+ days</li>
      </ul>
    </CivPanel>
  );
}
