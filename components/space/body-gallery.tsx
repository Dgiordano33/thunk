"use client";

import { useEffect, useMemo } from "react";
import { IsoViewport } from "@/components/world/iso-viewport";
import { BODY_KINDS } from "@/lib/world/bodies";
import { PLANET_PALETTES, PLANET_RADIUS } from "@/lib/world/system";
import { SceneContext, makeBody, useBodyHover, useSceneStore, type SceneBody } from "./scene/scene-store";
import { SpaceCanvas } from "./scene/space-canvas";
import { Sphere } from "./sphere";

const CELL_W = 150;
const CELL_H = 150;
const PAD = 90;

/** Design mock (`?gallery`): every body type × palette, plus a dormant row, for tuning the shaders. */
export function BodyGallery() {
  const scene = useSceneStore();
  const rows = BODY_KINDS.length + 1;
  const w = PAD * 2 + CELL_W * PLANET_PALETTES.length;
  const h = PAD * 2 + CELL_H * rows;
  const bodies = useMemo(
    () =>
      Array.from({ length: rows }, (_, row) =>
        PLANET_PALETTES.map((palette, col) => {
          const dormant = row === BODY_KINDS.length;
          const kind = dormant ? BODY_KINDS[col % BODY_KINDS.length] : BODY_KINDS[row];
          const level = BODY_KINDS.indexOf(kind) + 1;
          return makeBody({ id: `gallery-${row}-${col}`, x: PAD + CELL_W * (col + 0.5), y: PAD + CELL_H * (row + 0.5), r: PLANET_RADIUS[level - 1], kind, palette, dormant, order: row * 8 + col });
        }),
      ).flat(),
    [rows],
  );
  useEffect(() => scene.setData({ bodies, orbits: [], star: null, keyLight: -2.3 }), [scene, bodies]);
  return (
    <SceneContext.Provider value={scene}>
      <div className="space space-enter absolute inset-0">
        <IsoViewport
          width={w}
          height={h}
          label="Body gallery"
          smooth
          underlay={<SpaceCanvas scene={scene} />}
          onView={scene.setView}
          controlsClassName="map-controls"
          stage={bodies.map((b, i) => <Cell key={b.id} body={b} palette={PLANET_PALETTES[i % PLANET_PALETTES.length].name} />)}
        />
      </div>
    </SceneContext.Provider>
  );
}

function Cell({ body, palette }: { body: SceneBody; palette: string }) {
  const hover = useBodyHover(body.id);
  const p = PLANET_PALETTES.find((x) => x.name === palette)!;
  return (
    <div className="sp-body group absolute flex flex-col items-center" style={{ left: body.x, top: body.y, transform: `translate(-50%, -${body.r}px)`, "--i": body.order } as React.CSSProperties} {...hover}>
      <span className="relative flex items-center justify-center" style={{ width: 2 * body.r, height: 2 * body.r }}>
        <span className="sp-enter-body absolute flex items-center justify-center">
          <Sphere r={body.r} palette={p} light={-2.3} bands={body.spec.kind !== "rock" && body.spec.kind !== "ice"} ringed={!!body.spec.ring} dim={body.dormant} />
        </span>
      </span>
      <span className="planet-label sp-enter-label mt-6 flex flex-col items-center whitespace-nowrap">
        <span className={body.dormant ? "sp-name is-dim" : "sp-name"}>{body.spec.kind}</span>
        <span className="sp-meta">{palette}{body.dormant ? " · dormant" : ""}</span>
      </span>
    </div>
  );
}
