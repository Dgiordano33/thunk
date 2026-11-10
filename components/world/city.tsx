"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { memo } from "react";
import { relativeTime } from "@/components/session/labels";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { LEVEL_NAMES, cityScore, type CityActivity, type CityLevel, type WorldCity } from "@/lib/world/cities";
import { toIso } from "@/lib/world/terrain";
import { cn } from "@/lib/utils";
import { CivPanel } from "./civ-panel";
import { DOOR, GOLD, STONE, STONE_DARK, WALL, WOOD, flag, house, hut, r } from "./pixel-parts";
import { projectPath } from "@/lib/routes";

/** Sprite grid: 32×28 pixels drawn at 2× so it reads as pixel art on a 64px tile. */
const SPRITE_W = 32;
const SPRITE_H = 28;
const SCALE = 2;

const palisade = (y: number) => Array.from({ length: 14 }, (_, i) => r(2 + i * 2, y - 5, 1, 5, WOOD));

const stoneWall = (y: number) => [
  r(1, y - 6, 30, 6, STONE),
  r(1, y - 1, 30, 1, STONE_DARK),
  ...Array.from({ length: 10 }, (_, i) => r(1 + i * 3, y - 7, 2, 1, STONE)),
  r(13, y - 4, 5, 4, DOOR),
  r(14, y - 5, 3, 1, DOOR),
];

const tower = (x: number, y: number) => [
  r(x, y - 15, 6, 15, STONE),
  r(x + 5, y - 15, 1, 15, STONE_DARK),
  r(x, y - 16, 1, 1, STONE),
  r(x + 2, y - 16, 2, 1, STONE),
  r(x + 5, y - 16, 1, 1, STONE),
  r(x + 2, y - 11, 2, 3, DOOR),
];

const spire = () => [
  r(13, 17, 6, 3, GOLD),
  r(14, 5, 4, 12, WALL),
  r(17, 5, 1, 12, STONE),
  r(15, 2, 2, 3, GOLD),
  r(15.5, 0, 1, 2, GOLD),
  r(15, 9, 2, 2, DOOR),
];

/** Chimney tops (sprite pixels) that smoke rises from when a session is running. */
const CHIMNEYS: Record<CityLevel, [number, number][]> = {
  1: [[15, 19]],
  2: [[19, 13], [11, 17]],
  3: [[19, 13], [27, 17]],
  4: [[11, 9], [21, 8]],
  5: [[10, 10], [23, 9]],
};

function Sprite({ level, roof, banner }: { level: CityLevel; roof: string; banner: string }) {
  const ground = 26;
  const parts =
    level === 1
      ? [...hut(11, ground), ...flag(21, ground, banner)]
      : level === 2
        ? [...house(14, 22, roof), ...house(6, ground, roof), ...house(18, ground, roof), ...flag(27, ground - 1, banner)]
        : level === 3
          ? [...house(14, 22, roof), ...house(22, 26, roof), ...house(5, 24, roof), ...house(13, ground, roof), ...flag(3, 20, banner), ...palisade(28)]
          : level === 4
            ? [...house(6, 18, roof), ...house(16, 17, roof), ...tower(24, ground), ...house(10, 21, roof), ...stoneWall(ground + 1), ...flag(26, 10, banner)]
            : [...house(5, 19, roof), ...house(18, 18, roof), ...spire(), ...tower(1, ground - 1), ...tower(25, ground - 1), ...stoneWall(ground + 1), ...flag(27, 9, banner)];
  return (
    <svg
      viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`}
      width={SPRITE_W * SCALE}
      height={SPRITE_H * SCALE}
      shapeRendering="crispEdges"
      className="pixel overflow-visible"
      aria-hidden="true"
    >
      <ellipse cx={16} cy={ground + 0.5} rx={13} ry={2.5} fill="oklch(0 0 0 / 0.18)" />
      {parts}
    </svg>
  );
}

function Smoke({ level }: { level: CityLevel }) {
  const reduced = useReducedMotion();
  return (
    <>
      {CHIMNEYS[level].flatMap(([cx, cy], c) =>
        [0, 1, 2].map((i) => (
          <motion.span
            key={`${c}-${i}`}
            className="absolute size-1.5 bg-[oklch(0.92_0_0)]"
            style={{ left: cx * SCALE - 1, top: cy * SCALE - 4 }}
            initial={{ y: 0, opacity: 0 }}
            animate={reduced ? { opacity: 0.6, y: -6 } : { y: [-2, -22], x: [0, 5], opacity: [0, 0.85, 0], scale: [0.8, 1.7] }}
            transition={reduced ? { duration: 0 } : { duration: 2.1, repeat: Infinity, delay: i * 0.7 + c * 0.35, ease: "easeOut" }}
          />
        )),
      )}
    </>
  );
}

const ACTIVITY_STYLE: Record<Exclude<CityActivity, null>, string> = {
  "Needs attention": "bg-[oklch(0.86_0.17_90)] text-[oklch(0.25_0.05_60)]",
  "Session error": "bg-[oklch(0.62_0.21_25)] text-white",
  Running: "bg-[oklch(0.72_0.15_150)] text-[oklch(0.2_0.05_150)]",
};

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

export const City = memo(function City({ city, activity }: { city: WorldCity; activity: CityActivity }) {
  const { project, level, mood, hue } = city;
  const { x, y } = toIso(city.col, city.row);
  const dormant = mood === "dormant" && !activity;
  const banner = `oklch(0.66 0.2 ${hue})`;
  const roof = `oklch(0.5 0.15 ${hue})`;
  const alert = activity === "Needs attention" || activity === "Session error";

  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={projectPath(project)}
          draggable={false}
          aria-label={`${project.name}, ${LEVEL_NAMES[level - 1]}${activity ? `, ${activity}` : dormant ? ", dormant" : ""}`}
          className="group absolute flex flex-col items-center outline-none"
          // Anchor the sprite's ground line on the tile centre; the name plate hangs below.
          style={{ left: x, top: y + 8, transform: `translate(-50%, -${SPRITE_H * SCALE - 4}px)`, zIndex: city.col + city.row + 10 }}
        >
          <span className={cn("relative block transition-transform duration-150 group-hover:-translate-y-0.5", dormant && "grayscale-[0.8] brightness-90")}>
            <Sprite level={level} roof={roof} banner={banner} />
            {activity === "Running" && <Smoke level={level} />}
            {dormant && (
              <span className="pixel absolute -top-1 right-0 text-[10px] leading-none text-white/80 [text-shadow:1px_1px_0_#0006]">zzz</span>
            )}
            {alert && (
              <motion.span
                className={cn("pixel absolute -top-4 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center text-sm font-bold shadow-[2px_2px_0_#0005]", ACTIVITY_STYLE[activity])}
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              >
                !
              </motion.span>
            )}
          </span>
          <span className="pixel -mt-1 flex items-stretch whitespace-nowrap shadow-[2px_2px_0_#0006] ring-1 ring-black/40 group-focus-visible:ring-2 group-focus-visible:ring-white">
            <span className="flex min-w-5 items-center justify-center px-1 text-xs font-bold text-white" style={{ background: banner }}>
              {level}
            </span>
            <span className="bg-black/65 px-1.5 py-px text-[12px] leading-4 text-white">{project.name}</span>
          </span>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={10} className="w-72 rounded-none bg-transparent p-0 shadow-none ring-0">
        <CivPanel parchment bodyClassName="p-3">
          <div className="pixel flex items-center gap-2">
            <span className="flex size-6 items-center justify-center text-sm font-bold text-white" style={{ background: banner }}>
              {level}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base leading-tight">{project.name}</p>
              <p className="text-xs opacity-70">{LEVEL_NAMES[level - 1]} · pop. {cityScore(project)}</p>
            </div>
          </div>
          <p className="mt-2 truncate font-mono text-[11px] opacity-70">{project.repos.length > 1 ? `${project.repos.length} repositories` : project.repos[0] ? tildify(project.repos[0].path) : "No repositories"}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="opacity-70">Workspaces</dt>
            <dd className="text-right tabular-nums">{project.workspaceCount}</dd>
            <dt className="opacity-70">Sessions</dt>
            <dd className="text-right tabular-nums">{project.sessionCount}</dd>
            <dt className="opacity-70">Last activity</dt>
            <dd className="text-right">{project.lastActivityAt ? relativeTime(project.lastActivityAt) : "Never"}</dd>
            {(activity || dormant) && (
              <>
                <dt className="opacity-70">Status</dt>
                <dd className="text-right">{activity ?? "Dormant"}</dd>
              </>
            )}
          </dl>
          <Link href={projectPath(project)} className="pixel mt-3 block text-right text-sm underline-offset-2 hover:underline">
            Enter city →
          </Link>
        </CivPanel>
      </HoverCardContent>
    </HoverCard>
  );
});
