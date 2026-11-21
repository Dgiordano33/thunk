"use client";

import { useMemo } from "react";
import { useAmbient } from "@/lib/store/ambient-store";
import { cityActivity, type WorldCity } from "@/lib/world/cities";
import { MAP_H, MAP_W, WORLD, type Tile } from "@/lib/world/terrain";
import { City } from "./city";
import { IsoViewport } from "./iso-viewport";
import { TerrainLayer } from "./terrain-layer";

export function WorldMap({ tiles, cities, children }: { tiles: Tile[][]; cities: WorldCity[]; children?: React.ReactNode }) {
  const sessions = useAmbient((s) => s.sessions);
  const borders = useMemo(() => cities.map((c) => ({ id: c.project.id, hue: c.hue, cells: c.territory })), [cities]);
  return (
    <IsoViewport
      width={MAP_W}
      height={MAP_H}
      label="World map"
      stage={
        <>
          <TerrainLayer tiles={tiles} grid={WORLD} borders={borders} />
          {cities.map((city) => (
            <City key={city.project.id} city={city} activity={cityActivity(sessions, city.project.id)} />
          ))}
        </>
      }
    >
      <div aria-hidden="true" className="world-vignette pointer-events-none absolute inset-0 z-10" />
      {children}
    </IsoViewport>
  );
}
