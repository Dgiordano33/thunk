# Town map: one Town center, workspaces as farms

Status: implemented; browser visual verification pending · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-08

## Goal

The project view at `/p/:id` draws every active workspace as a town center, with the `main` workspace as the capital. That gives each workspace the visual weight of a settlement, and it makes the capital's panel double as the project panel. Workspaces are task-shaped and short-lived, so the map overstates them and understates the project.

This plan gives the project a single Town center that owns the project-level buildings and panel, turns each active workspace into a farm (a farmhouse with its fields), and marks fields fallow once their session is closed. Archived workspaces leave the map.

It also fixes two memory leaks the same relationship graph exposed: Claude's auto-memory writes land in the workspace, the ephemeral scope, and deleting a workspace wipes its memory and notes with no chance to keep what was learned. Part two below moves auto-memory to the project and adds a Harvest step.

Non-goals: changing the world map (`components/world/*`, `lib/world/cities.ts`), changing the on-disk layout under `~/.thunk`, agent-driven distillation of memory (listed under "Later"), or touching the chat and workspace routes under `/w`.

## Decisions

Decision: **one Town center per project.** It stands at the middle of the map and opens the project panel: name, level, total spend, workspace and session counts, external sessions, archived workspaces as a list, and project settings. It is not a workspace.

Decision: **a workspace is a farm.** Each active workspace gets a farmhouse on the lattice slot a town center occupies today. The farmhouse keeps the workspace's hue and branch nameplate and opens the workspace panel. Its sessions stay as fields in rings 2–3 around it. `main` is a farm like any other; it takes the first lattice slot, nearest the Town center, and gets no special sprite.

Decision: **archived workspaces leave the map.** They are listed in the Town center panel under "Archived", with the existing unarchive action. No fallow plots for whole workspaces; the lattice is for active work.

Decision: **fields go fallow when the session is closed.** A session whose persisted status is `closed` or `error` renders as a fallow field: bare soil in the workspace hue, no crop, no villager. Fallow fields keep their slot and open the session panel as before so history stays reachable. Crop stage continues to come from spend for every other status.

Decision: **project buildings cluster around the Town center.** Library, Workshop, Town hall and Vault move from the capital's flanks to the Town center's. The Town hall joins `layoutTown` so all four come from the layout rather than one being computed in the view.

Decision: **lattice spacing drops to 6.** A farmhouse sprite is smaller than a town center sprite, and the fields already fill rings 2–3, so ring 4 is enough of a lane. The Town center occupies the central lattice slot plus its ring 1–2 for buildings, so the first farm sits one lattice step out. Confirm with the ring tests before committing to 6; fall back to 7 if nameplates overlap.

## Layout

`layoutTown(seed, workspaces, sessions)` in `lib/world/town.ts` returns a new shape:

```ts
export type TownLayout = {
  grid: Grid;
  tiles: Tile[][];
  /** The project. Always at the middle. */
  center: Cell;
  library: Cell;
  workshop: Cell;
  townHall: Cell;
  vault: Cell;
  /** Farmhouse per active workspace id; `main` first, then oldest first. */
  farmhouses: { workspaceId: string; cell: Cell }[];
  /** Field per session id. Sessions that don't fit (oldest first) are counted in `overflow`. */
  fields: Record<string, Cell>;
  overflow: Record<string, number>;
};
```

Changes inside the function:

- Lattice size `k` is chosen so `(2k+1)² - 1 >= workspaces.length` (the central slot is the Town center). Lattice cells sort by Chebyshev distance then angle as today; skip `{0,0}`.
- `center = {mid, mid}`. Buildings sit at fixed offsets inside ring 1–2 of the center: library `(-2, +1)`, workshop `(+1, -2)`, vault `(-4, -3)` becomes `(-2, -2)`, town hall `(+2, +1)`. Reserve ring 0–2 of the center.
- Roads run from each farmhouse to the center, as they run to the capital today.
- Fields keep `FARM_RINGS = [2, 3]` around each farmhouse. Reserve ring 0–1 of each farmhouse.
- Terrain rules are unchanged except `near` measures to the nearest farmhouse or the center.
- Export `TOWN_SPACING = 6`.

`lib/world/town.test.mjs` gets: center at the middle; every farmhouse at least `TOWN_SPACING` from every other and from the center; buildings on distinct cells inside ring 2 of the center and not on a road or field; `main` is the first farmhouse; no field on a reserved cell; overflow counts unchanged.

## View

`components/town/town-view.tsx`:

- Props: `center: Cell`, `townHall: Cell`, `farms: TownFarmhouse[]` (rename of `TownWorkspace`, drop `capital`), `fields: TownField[]` (rename of `TownFarm`, add `fallow: boolean`).
- Draw `<TownCenterBuilding>` once at `center`. It opens `?building=center`. Attention dot when any session in the project needs attention, mirroring the capital's current rule.
- Draw `<Farmhouse>` per workspace. Nameplate shows label and branch; hover card shows session count, overflow, delivery cue, last activity. Attention dot from the workspace's sessions, as the town center shows today.
- `Field` passes `fallow` to `FarmField`. A fallow field shows no villager and no alert. Its hover card reads "Fallow · session closed" in place of the crop row.
- Remove `TOWN_HALL_OFFSET`; place the Town hall at `townHall` from the layout.
- Legend: replace "Town center = workspace, capital = main" with "Town center = project", add "Farmhouse = workspace" and "Fallow field = closed session".

`components/town/sprites.tsx`:

- Add `FARMHOUSE_SIZE` and `FarmhouseSprite({ hue, running })`: a small gabled house with a hue-tinted roof and a door, about 28×28 at `SPRITE_SCALE`. Smoke from the chimney when `running`, like the town center's current activity cue.
- `TownCenterSprite` loses its `capital` prop and `hue` prop; it always draws the capital variant in a fixed civic color. One Town center per map needs no hue.
- `FarmField` gains `fallow: boolean`. Fallow draws stage 0 soil with the hue applied to the border only and no crop pixels.

`TownSelection.building` gains `"center"`.

## Page and panels

`app/(world)/p/[id]/page.tsx`:

- Map `layout.farmhouses` to `TownFarmhouse[]`. Hue is `cityHue(w.id)` for every workspace, including `main`. Drop the `capital` branch.
- Map sessions to fields with `fallow: s.status === "closed" || s.status === "error"`. `listSessions` already returns persisted status merged with live state, so no new query is needed.
- `?building=center` renders the new `ProjectPanel`. `?ws=` renders `FarmPanel`.

`components/town/panels.tsx`:

- Split `TownCenterPanel` into `ProjectPanel` and `FarmPanel`.
- `ProjectPanel` takes what the capital branch owns today: level and stats grid (`Farms`, `Fields`, `Spend`), external sessions, archived workspaces with unarchive, `ProjectSettings`, and project-scoped `TownNotes`. New workspace button lives here.
- `FarmPanel` takes the workspace branch: branch and extra repos, "Sow a new field" and "Open workspace", `DeliveryPanel`, the field list (fallow fields greyed, sorted after live ones), workspace-scoped `TownNotes`, and `WorkspaceMenu` for every workspace, `main` included.
- Eyebrows: "Town center · project" and "Farm · workspace".

## Copy and docs

- `PRODUCT.md` Terminology: "Within the map, projects appear as cities on the world map and as a town center up close, workspaces as farms, and sessions as fields."
- `README.md` map section, if it describes town centers, says the same.
- `lib/world/town.ts` header comment updated.

## Steps

1. Layout: new `TownLayout` shape, central Town center, town hall in layout, spacing 6, tests. Pure change, no UI yet.
2. Sprites: `FarmhouseSprite`, `FarmField` fallow variant, `TownCenterSprite` without `capital`/`hue`.
3. View: render center, farmhouses, fields with fallow; legend.
4. Page and panels: split panels, `?building=center`, fallow from session status, remove archived workspaces from the lattice input (they are already filtered; keep the filter and drop the ruins section from the workspace panel).
5. Copy: `PRODUCT.md`, header comments, legend text.
6. Verify: `npm test` for `lib/world`, `npm run lint`, `npm run build`, then open a project with `main` plus two worktree workspaces, one closed session, and one archived workspace. Check nameplates don't overlap at spacing 6, the archived workspace is absent from the map and present in the Town center panel, and the closed session is fallow.

# Part two: memory that survives the farm

## The leaks

Memory is scoped correctly on paper. Project memory (`~/.thunk/projects/<slug>/memory/MEMORY.md`) and project notes are durable; workspace memory and workspace notes (`.../workspaces/<slug>/{memory,notes}`) are task state. The prompt in `hierarchyPrompt` says so. Two write paths ignore it:

- **Auto-memory points at the workspace.** `buildOptions` in `lib/agent/options.ts` sets `settings.autoMemoryDirectory` to `workspaceMemoryDir`. Claude Code's auto-memory is where the agent saves what it learns without being asked, and that is mostly durable project knowledge: conventions, gotchas, decisions. It lands in the scope that gets deleted.
- **Deletion is a wipe.** `removeWorkspace({ removeMemory: true })` runs `rm -rf` on the workspace's data dir, memory and notes together. It is called from the delete menu, from merge-and-delete in the Git route, and from routine cleanup in `lib/routines/runner.ts`. `archiveWorkspace` keeps the files but nothing surfaces them afterwards.

## Decisions

Decision: **auto-memory is project memory.** `autoMemoryDirectory` becomes `projectMemoryDir(project.root)`. Every Claude session in every workspace of the project reads and writes the same auto-memory, which is what "facts that hold for the whole repo" means. Claude Code loads `MEMORY.md` from that directory itself, so the explicit "Project memory (current contents)" block in the Claude system prompt is dropped to avoid sending it twice. Codex keeps the injected block; it has no auto-memory.

Decision: **workspace memory stays, as the explicit task log.** The file is unchanged; the prompt stops calling it "your auto-memory directory" and describes it as the shared task log every session in the workspace should read first and update as it goes. Codex already works this way.

Decision: **deleting a workspace never destroys its memory or notes.** `removeWorkspace` moves `.../workspaces/<slug>` to `.../granary/<slug>-<yyyymmdd-hhmmss>` instead of removing it. The move is unconditional and applies to the delete menu, merge-and-delete, and routine cleanup alike. A granary entry whose `MEMORY.md` is header-only and whose notes dir is empty is deleted outright, so routines that produce nothing leave nothing behind.

Decision: **Harvest is the one place workspace knowledge is promoted.** It appears as an action in the farm panel and workspace menu, as a step in the delete and merge-and-delete flows, and as an offer after archive. It never runs automatically for routines; the granary covers them.

Decision: **harvest writes to project memory under a dated heading.** Appending `## Harvested from <workspace name> · <date>` followed by the text the person kept is simple, reviewable in the memory editor, and does not try to merge prose. Keeping project memory short is the person's job and the agent's, as the prompt already says.

Decision: **harvested notes move, they do not copy.** A note promoted from workspace scope to project scope is moved on disk with its id kept, and `noteId` links on tasks are re-pointed. Both scopes use the same `NoteDirs` store, so this is a rename plus a task update.

## On-disk shape

```
~/.thunk/projects/<project-slug>/
  memory/MEMORY.md            project memory; Claude auto-memory writes here too
  notes/                      project notes
  workspaces/<slug>/
    memory/MEMORY.md          workspace task log
    notes/
  granary/<slug>-<timestamp>/ moved here on delete; same inner layout
```

`lib/projects/paths.ts` gains `projectGranaryDir(root)` and `granaryEntryDir(root, slug, when)`.

## Server

`lib/projects/harvest.ts` (new, server-only):

- `readHarvest(ctx)` returns `{ memory: string, notes: NoteSummary[] }` for the workspace, plus the project memory so the dialog can show both.
- `harvestWorkspace(ctx, { memory: string | null, noteIds: string[] })`: if `memory` is non-empty, appends the dated section to project memory through `writeMemory` with a fresh read as `expectedContent`, retrying once on conflict. Moves each listed note from `workspaceNoteDirs` to `projectNoteDirs`, generating a new id only on collision, and updates `tasks.note_id` for tasks linked to it. Emits the existing note SSE events (`removed` on the workspace scope, `changed` on the project scope).
- Returns what it wrote so the UI can confirm.

`lib/projects/index.ts`:

- `removeWorkspace` drops the `removeMemory` option. After `deleteWorkspaceRow`, it calls `moveToGranary(project, ws.slug)`, which renames the workspace dir into the granary or deletes it when trivial. Callers in `app/api/workspaces/[id]/route.ts`, the Git route, and `lib/routines/runner.ts` stop passing `removeMemory`.
- The `?memory=1` query on `DELETE /api/workspaces/:id` is accepted and ignored for one release, then removed.

`lib/agent/options.ts`:

- `settings.autoMemoryDirectory` becomes `projectMemoryDir(project.root)`.
- `hierarchyPrompt` for Claude: project memory line gains "This is also your auto-memory directory, so what you save on your own lands here." Workspace memory line drops "(your auto-memory directory)" and gains "Read it at the start of a task and update it as you go." The "Project memory (current contents)" block is emitted only when `provider === "codex"`.
- `additionalDirectories` already includes `projectMemoryDir`; `workspaceMemoryDir` is added so file tools can still edit the task log.

API:

- `GET /api/workspaces/:id/harvest` returns `readHarvest`.
- `POST /api/workspaces/:id/harvest` with `{ memory: string | null, noteIds: string[] }` runs `harvestWorkspace`. 409 when the workspace is mid-lock.

## UI

`components/workspace/harvest-dialog.tsx` (new):

- Left: workspace `MEMORY.md`, read-only. Right: an editable textarea prefilled with the same text, labelled "Keep in project memory". Below: the workspace's notes as checkboxes, all unchecked, labelled "Move to project notes". A collapsed "Project memory today" preview so the person can see what they are adding to.
- Buttons depend on the entry point. From the menu: "Harvest". From delete: "Harvest and delete", "Delete without harvesting", "Cancel". From merge-and-delete: same with "merge" in the labels. The destructive button is secondary.
- Empty state: when workspace memory is header-only and there are no notes, the dialog is skipped and the existing `window.confirm` text runs, amended to say memory and notes go to the granary.

`components/workspace/workspace-menu.tsx`: add "Harvest" above "Archive". `remove` and `mergeAndDelete` open the dialog instead of `window.confirm`. Archive stays one click and shows a toast with a "Harvest" link afterwards.

`components/town/panels.tsx`: `FarmPanel` gets a "Harvest" button next to "Open workspace".

`lib/client/api.ts`: `getHarvest(id)`, `harvestWorkspace(id, body)`; `deleteWorkspace` loses the `memory` option.

## Copy

- `PRODUCT.md` Operating Context: "Project memory is also Claude's auto-memory, so what agents learn on their own is durable. Workspace memory is the task log. Harvest moves what a workspace learned into the project before the workspace goes."
- Legend and farm panel: "Harvest: keep what this farm learned."

## Steps (continued)

7. Paths and granary: `projectGranaryDir`, `moveToGranary`, `removeWorkspace` without `removeMemory`, update the three callers. Test with `node --test` on a temp `THUNK_DATA_DIR`: delete moves a populated dir, removes a trivial one.
8. Auto-memory: re-point `autoMemoryDirectory`, update `hierarchyPrompt`, drop the duplicate block for Claude, add `workspaceMemoryDir` to `additionalDirectories`. Verify in a live Claude session that a saved memory appears in project `MEMORY.md` and that the system prompt has one copy of it.
9. Harvest server: `lib/projects/harvest.ts`, the two API routes, note move with task re-link. Tests for the dated append, collision rename, and task re-pointing.
10. Harvest UI: dialog, menu and panel entry points, archive toast, client API.
11. Copy: `PRODUCT.md`, prompt text, confirm strings.
12. Verify end to end: create a workspace, let a Claude session save a memory, confirm it lands in project memory; write a workspace note and task log; harvest and delete; confirm the note moved with its task link intact, the appended section is in project memory, and the granary holds the workspace dir.

## Later

- Agent-assisted harvest: a one-shot prompt that reads the workspace log and proposes the durable lines, prefilled into the "Keep" textarea.
- Granary browsing and restore from the Town center panel; pruning entries older than a configurable age.
- Auto-memory topic files beyond `MEMORY.md`: show them in the project memory editor instead of only the index.

## Implementation verification

- Layout, farmhouses, fallow fields, separate project/farm panels, Harvest UI and API, project auto-memory, and granary preservation are implemented.
- Spacing remains 6. All candidate field slots are reserved independently of session count so adjacent farms cannot overlap or displace each other's fields.
- Granary moves happen inside the workspace lock before deleting the database row, with restoration on database failure. Entry names include a unique suffix to avoid same-time collisions. Topic files and unknown files are preserved.
- Automated checks cover dense layout, stable neighbouring fields, fallow sprites, populated/trivial granary entries, note collisions, task re-linking and provider memory configuration.
- Isolated HTTP checks verified page rendering, Harvest promotion/validation, and harvest followed by workspace/worktree deletion with remaining notes preserved. A live Claude SDK check read project auto-memory and saved a new fact in that directory.
- Browser automation was unavailable. Nameplate spacing and interactive dialog behavior still need visual review. Closed-session persistence was not exercised against Supabase; the isolated HTTP fixture used memory mode, which does not persist closed sessions.
