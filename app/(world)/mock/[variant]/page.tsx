import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanetView, type PlanetMoon, type PlanetSatellite, type PlanetSection } from "@/components/space/planet-view";
import { SystemMap } from "@/components/space/system-map";
import { TownPanel } from "@/components/town/town-panel";
import { MockTheme } from "@/components/world/mock-theme";
import { WorldMap } from "@/components/world/world-map";
import type { ProjectSummary } from "@/lib/projects/types";
import { cityHue, cityLevel, cityMood, type CityActivity, type WorldCity } from "@/lib/world/cities";
import { layoutPlanet, spendStep } from "@/lib/world/planet";
import { generateTerrain, placeCities, territory } from "@/lib/world/terrain";
import "./mock-themes.css";

export const dynamic = "force-dynamic";

// Palette explorations: obsidian/vellum (mono), moonlit (KH1 cover night), dusk (violet twilight),
// and solar / solar-light, the solar-system re-theme. Solar takes `?planet=<project>` and `?ws=<workspace>`.
const VARIANTS = {
  obsidian: { dark: true },
  vellum: { dark: false },
  moonlit: { dark: true },
  dusk: { dark: true },
  solar: { dark: true },
  "solar-light": { dark: false },
} as const;

const day = 86_400_000;
const hour = 3_600_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const fake = (id: string, name: string, workspaceCount: number, sessionCount: number, lastDays: number | null, createdDays: number): ProjectSummary => ({
  id,
  name,
  dataKey: name,
  slug: name,
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
// The solar mocks add a few more, so a second orbit is in use.
const MORE: ProjectSummary[] = [
  fake("api-gateway", "api-gateway", 2, 5, 4, 15),
  fake("design-tokens", "design-tokens", 1, 2, 70, 12),
  fake("ops-runbooks", "ops-runbooks", 5, 14, 1, 10),
];
const ACTIVITY: Record<string, CityActivity> = { thunk: "Needs attention", "checkly-studio": "Running", "rake-ads": "Session error", "ops-runbooks": "Running" };

export default async function MockWorld({ params, searchParams }: PageProps<"/mock/[variant]">) {
  const { variant } = await params;
  const query = await searchParams;
  if (!(variant in VARIANTS)) notFound();
  const { dark } = VARIANTS[variant as keyof typeof VARIANTS];

  if (variant === "solar" || variant === "solar-light") {
    const planet = typeof query.planet === "string" ? query.planet : undefined;
    const ws = typeof query.ws === "string" ? query.ws : undefined;
    return (
      <>
        <MockTheme variant={variant} dark={dark} look="space" />
        {planet ? <MockPlanet base={`/mock/${variant}?planet=${planet}`} name={planet} ws={ws} /> : <SystemMap projects={[...PROJECTS, ...MORE]} activity={ACTIVITY} />}
      </>
    );
  }

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
      <MockTheme variant={variant} dark={dark} look="world" />
      <WorldMap tiles={tiles} cities={cities} />
    </>
  );
}

// A busy project: six workspaces, sessions at every spend step, one waiting on you, one failed, two running.
const WORKSPACES = [
  { id: "main", slug: "main", label: "main", branch: "main", createdAt: ago(120) },
  { id: "api-refactor", slug: "api-refactor", label: "api-refactor", branch: "feat/api-routes", createdAt: ago(20) },
  { id: "fix-auth", slug: "fix-auth", label: "fix-auth", branch: "fix/session-expiry", createdAt: ago(9) },
  { id: "docs-sweep", slug: "docs-sweep", label: "docs-sweep", branch: "docs/sweep", createdAt: ago(6) },
  { id: "onboarding", slug: "onboarding", label: "onboarding", branch: "feat/onboarding", createdAt: ago(3) },
  { id: "perf", slug: "perf", label: "perf-budget", branch: "perf/budget", createdAt: ago(1) },
];
const SESSIONS: { ws: string; title: string; cost: number; closed?: boolean; status?: string; pending?: number }[] = [
  { ws: "main", title: "Triage inbox", cost: 0.004, closed: true },
  { ws: "main", title: "Release notes", cost: 0.8 },
  { ws: "main", title: "Upgrade Next", cost: 6.2, closed: true },
  { ws: "main", title: "Plan Q1", cost: 2.4 },
  { ws: "main", title: "Fix flaky e2e", cost: 1.1, status: "running" },
  { ws: "api-refactor", title: "Refactor routes", cost: 2.1, status: "running" },
  { ws: "api-refactor", title: "Add tests", cost: 0.42 },
  { ws: "api-refactor", title: "Spike: tRPC", cost: 0.03, closed: true },
  { ws: "fix-auth", title: "Repro expiry bug", cost: 0.6 },
  { ws: "fix-auth", title: "Patch refresh flow", cost: 1.4, status: "awaiting", pending: 1 },
  { ws: "docs-sweep", title: "Audit README", cost: 0.2 },
  { ws: "docs-sweep", title: "Rewrite design.md", cost: 3.3 },
  { ws: "docs-sweep", title: "Link checker", cost: 0.05, status: "error" },
  { ws: "onboarding", title: "Empty states", cost: 0 },
  { ws: "perf", title: "Bundle report", cost: 0.12 },
  ...Array.from({ length: 9 }, (_, i) => ({ ws: "main", title: `Chore ${i + 1}`, cost: [0.02, 0.3, 0.7, 1.2, 2.2, 0.01, 4.1, 5.5, 0.9][i], closed: i % 3 === 0 })),
];
const CUES = {
  "api-refactor": { label: "Checks passed", symbol: "✓", color: "#277443", kind: "pass" },
  "fix-auth": { label: "Checks running", symbol: "…", color: "#986000", kind: "pending" },
  "docs-sweep": { label: "Failing checks or conflicts", symbol: "×", color: "#b93434", kind: "fail" },
  onboarding: { label: "Draft PR", symbol: "–", color: "#737373", kind: "draft" },
};

function MockPlanet({ base, name, ws }: { base: string; name: string; ws?: string }) {
  const sessions = SESSIONS.map((s, i) => ({ ...s, id: `s${i}`, workspaceId: s.ws, createdAt: ago(((SESSIONS.length - i) * 5 * hour) / day) }));
  const layout = layoutPlanet(WORKSPACES, sessions);
  const moons: PlanetMoon[] = layout.moons.map((m) => {
    const w = WORKSPACES.find((x) => x.id === m.workspaceId)!;
    return { id: w.id, label: w.label, branch: w.branch, sessionCount: sessions.filter((s) => s.ws === w.id).length, overflow: layout.overflow[w.id] ?? 0, lastActivityAt: ago(0.2), x: m.x, y: m.y };
  });
  const satellites: PlanetSatellite[] = sessions.flatMap((s) => {
    const p = layout.satellites[s.id];
    return p ? [{ id: s.id, workspaceId: s.ws, title: s.title, model: "claude-opus", createdAt: s.createdAt, costUsd: s.cost, step: spendStep(s.cost), closed: !!s.closed, ...p }] : [];
  });
  const live = Object.fromEntries(sessions.map((s) => [s.id, { status: s.closed ? "closed" : s.status ?? "idle", pending: s.pending ?? 0 }]));
  const sections: PlanetSection[] = [
    { key: "notes", label: "Notes", href: base, count: 12 },
    { key: "tasks", label: "Tasks", href: base, count: 4 },
    { key: "routines", label: "Routines", href: base, count: 2, attention: true },
    { key: "vault", label: "Vault", href: base, count: 7 },
    { key: "canvas", label: "Canvas", href: base },
  ];
  const open = WORKSPACES.find((w) => w.id === ws);
  return (
    <PlanetView
      projectId={name}
      projectName={name}
      baseHref={base}
      overviewHref={base}
      layout={layout}
      moons={moons}
      satellites={satellites}
      sections={sections}
      selected={{ ws }}
      live={live}
      cues={CUES}
      panelOpen={!!open}
    >
      {open && (
        <TownPanel eyebrow="Workspace" title={open.label} closeHref={base}>
          <div className="space-y-4 p-4 text-sm">
            <p className="text-muted-foreground font-mono text-xs">{open.branch} · 2 files changed</p>
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Sessions</p>
              <ul className="divide-y rounded-lg border">
                {sessions.filter((s) => s.ws === open.id).map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                    <span className={`satellite block size-2 rounded-full ${s.closed ? "is-closed" : s.status === "running" ? "is-running" : s.pending ? "is-attention" : "is-open"}`} />
                    <span className="flex-1 truncate">{s.title}{s.closed && <span className="text-muted-foreground"> · closed</span>}</span>
                    <span className="text-muted-foreground tabular-nums">${s.cost.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Link href={base} className="block text-right font-medium underline-offset-2 hover:underline">Open workspace →</Link>
          </div>
        </TownPanel>
      )}
    </PlanetView>
  );
}
