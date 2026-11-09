import { notFound } from "next/navigation";
import { MockTheme } from "@/components/world/mock-theme";
import { WorldMap } from "@/components/world/world-map";
import type { ProjectSummary } from "@/lib/projects/types";
import { cityHue, cityLevel, cityMood, type WorldCity } from "@/lib/world/cities";
import { generateTerrain, placeCities, territory } from "@/lib/world/terrain";
import "./mock-themes.css";

export const dynamic = "force-dynamic";

// Palette explorations for the world map: obsidian/vellum (mono), moonlit (KH1 cover night), dusk (violet twilight).
const VARIANTS = { obsidian: { dark: true }, vellum: { dark: false }, moonlit: { dark: true }, dusk: { dark: true } } as const;

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const fake = (id: string, name: string, workspaceCount: number, sessionCount: number, lastDays: number | null, createdDays: number): ProjectSummary => ({
  id,
  name,
  dataKey: name,
  repos: [{ id: `${id}-repo`, projectId: id, name, path: `/Users/dan/code/${name}`, kind: "repo", remote: null, defaultBranch: "main", createdAt: ago(createdDays) }],
  repoFolders: [],
  createdAt: ago(createdDays),
  updatedAt: ago(createdDays),
  workspaceCount,
  sessionCount,
  lastActivityAt: lastDays === null ? null : ago(lastDays),
});

const PROJECTS: ProjectSummary[] = [
  fake("thunk", "thunk", 9, 22, 0, 120),
  fake("checkly-studio", "checkly-studio", 4, 7, 1, 90),
  fake("marketing-site", "marketing-site", 2, 3, 3, 60),
  fake("gtm-book", "gtm-book", 1, 1, 45, 200),
  fake("rake-ads", "rake-ads", 0, 1, 8, 20),
  fake("docs", "docs", 3, 9, 2, 300),
];

export default async function MockWorld({ params }: PageProps<"/mock/[variant]">) {
  const { variant } = await params;
  if (!(variant in VARIANTS)) notFound();
  const { dark } = VARIANTS[variant as keyof typeof VARIANTS];

  const tiles = generateTerrain();
  const placed = placeCities(PROJECTS, tiles);
  const cities: WorldCity[] = PROJECTS.flatMap((project) => {
    const cell = placed.get(project.id);
    if (!cell) return [];
    const level = cityLevel(project);
    return [{ project, ...cell, level, mood: cityMood(project), hue: cityHue(project.id), territory: territory(cell, level, tiles) }];
  });

  return (
    <>
      <MockTheme variant={variant} dark={dark} />
      <WorldMap tiles={tiles} cities={cities} />
    </>
  );
}
