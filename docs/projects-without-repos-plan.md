# Projects that work without repos

## Context

PR #33 made a project a name with zero or more equal repos. Memory, notes, vault, tasks and routines already belong to the project. Three things still come from a repo, so a project like "Marketing" or "Product Launches" is second-class:

1. **Instructions and connectors.** `CLAUDE.md`, `.claude/` and `.mcp.json` load only from the session's anchor repo (`lib/agent/options.ts:89-107`, `settingSources: ["project", "local"]`). A zero-repo project gets Thunk's own tools and nothing else.
2. **Workspaces.** `createWorkspace` refuses a worktree workspace with no git repo, and `NewWorkspaceButton` is disabled without one. A folder-only project is stuck with `main`.
3. **Shared repos.** Worktree paths and branches come from the workspace slug, unique only within a project. Two projects sharing a repo can collide.

## Decisions

- **The project holds its own instructions and connectors**, as files under `~/.thunk/projects/<dataKey>/config/`. Files, not database rows: memory, notes and vault already live there, it works in memory-only mode, and connector secrets stay on this machine instead of going to Supabase.
- **They add to a repo's config, never replace it.** A session in a repo still gets that repo's `CLAUDE.md` and `.mcp.json`. So this is injected by Thunk, not done with `projectConfigRoot` (which swaps the config root).
- **A workspace is a thread of work, with or without git.** Git repos get worktrees. Plain folders are shared in place. No repos at all means the workspace gets its own scratch directory.
- **Agents cannot edit the project's config.** Instructions are the user's; memory is the agent's. Connectors run commands, so an agent must not be able to grant itself one.
- **Instructions stay small (confirmed with the user).** Memory is the main way a project learns; instructions are expected to be used rarely. So: one plain textarea, empty by default, no template, no wizard field.
- **Status: implemented (2026-11-09).** All five non-deferred phases are complete. Deferred items remain out of scope; verification limits are recorded below.

## Target layout

```
~/.thunk/projects/<dataKey>/
  config/
    INSTRUCTIONS.md     user-written, injected into every session
    mcp.json            { "mcpServers": { ... } }, same shape as .mcp.json
  memory/ notes/ vault/ workspaces/ ...   (unchanged)
~/.thunk/homes/<dataKey>/                 main workspace of a zero-repo project (unchanged)
~/.thunk/homes/<dataKey>--<slug>/         other workspaces of a zero-repo project (new)
```

## Phases (each leaves `npm test` green)

### 1. Project instructions
- `lib/projects/paths.ts`: `projectConfigDir(key)`, `projectInstructionsFile(key)`.
- `lib/agent/options.ts` `hierarchyPrompt`: add a `## Project instructions` section with the file's contents, before memory. Used by both Claude and Codex (Codex gets it through `developerInstructions`). Cap it like injected notes (`lib/notes/prompt.ts:9`) and say so when truncated.
- Deny agent writes to `config/`: add it to the existing vault deny rules (`options.ts:107-110`: `permissions.deny` and `sandbox.filesystem.denyWrite`). Keep it out of Codex `writableRoots` (it already is).
- API: `GET/PUT /api/projects/[id]/instructions`, modelled on `app/api/projects/[id]/memory/route.ts`.
- UI: "Instructions" in the Town center panel's Settings section (`components/town/project-settings.tsx`), a plain markdown textarea with Save. Changes apply to new sessions.
- Tests: prompt contains instructions for a zero-repo and a repo project; truncation; a session's options deny the config dir.

### 2. Project connectors
- `lib/projects/connectors.ts`: read and validate `config/mcp.json` with zod (stdio `command/args/env`, and `http`/`sse` `url/headers`). Invalid file → connectors skipped, error surfaced in the UI, session still starts.
- Claude: merge into `mcpServers` in `buildOptions` next to `thunk`. The name `thunk` is reserved.
- Codex: pass stdio and HTTP servers through `config.mcp_servers` on `thread/start` and `thread/resume`. Legacy SSE remains Claude-only and is labelled in the UI.
- API: `GET/PUT /api/projects/[id]/connectors`. GET returns names, type and target but masks `env` and `headers` values; PUT accepts full JSON, and a masked value means "keep what's stored".
- UI: "Connectors" section listing each server, with a JSON editor (v1). A form and a catalog are later work.
- Tests: valid and invalid files; reserved name; masking round-trip keeps secrets; options contain the merged servers.

### 3. Workspaces without git
- `createWorkspace` (`lib/projects/index.ts`): if none of the chosen repos is a git repo, create an in-place workspace instead of throwing. `cwd` = first chosen folder, else a new scratch dir `projectHomeDir(key) + "--" + slug`.
- `removeWorkspace`: delete that scratch dir only when it is empty; otherwise leave it and say where it is.
- `NewWorkspaceButton`: enabled for every project; drop the "Add a git repo" hint. With repos, the picker stays.
- `contextForDirectory`: a folder shared by several workspaces resolves to the oldest (main). Already true; add a test.
- Copy: `harvest-dialog.tsx` and `workspace-menu.tsx` say "worktree" unconditionally; branch on `workspace.branch`.
- Hide git-only UI when the workspace has no git target: PR button (already), delivery cue, changes panel, checkpoints.
- Routines: keep "fresh worktree" targets refused without git (`lib/routines/service.ts:21`). They can target any workspace, including these. Revisit if needed.
- Tests: extend `tests/repoless.test.cjs` (zero-repo and folder-only workspaces; distinct scratch dirs; removal).

### 4. Shared repos across projects
- Before creating a worktree, check the path and branch are free in that repo (`git worktree list`, `branchExists`). On a clash, suffix the slug the same way a slug clash inside a project is handled (`index.ts:211`).
- Test: two projects sharing one repo both create a workspace named `paris`.

### 5. Polish for non-code projects
- Zero-repo empty state: offer "Add a folder" as the place work is saved, since the scratch dir is hidden under `~/.thunk`. Show the working directory with a Reveal in Finder action.
- Remember the last repo selection per project in `NewWorkspaceButton`, so a broad project doesn't default to a worktree in every repo.

## Deferred
- Project-level slash commands, skills and subagents. Candidate: pass `config/` as an SDK plugin (`plugins` option), which carries all three. Needs a spike on plugin layout and command namespacing.
- Choosing which repo is the anchor (today: the first added).
- Per-repo lifecycle scripts, and migration 0010 dropping the old columns (both from the previous plan).

## Risks / unknowns
- **Codex connectors**: per-thread configuration verified with the installed app-server using connector discovery and a tool call, without a model request.
- **Name clashes**: verified with the installed Claude SDK that the project connector overrides a same-named connector in the repo's `.mcp.json`.
- **Write protection is not absolute**: in `bypassPermissions` (Claude) and `danger-full-access` (Codex) the deny rules don't hold, same as the vault today. An agent in those modes could edit `mcp.json` and gain a connector in the next session. Mitigation to consider: record a hash when the user saves, and ignore a file that changed outside the UI until re-approved.
- **Secrets on disk**: connector tokens sit in plain text in `~/.thunk`. Acceptable for a local app; note it in the UI.
- **Prompt size**: long instructions plus memory plus injected notes. The cap in phase 1 is the guard.
- **Running sessions** keep the instructions and connectors they started with.

## Verification
- `npm test`, `npx tsc --noEmit`, lint after each phase.
- Browser, memory-only mode: create "Marketing" with no repos; write instructions; add a connector; start a session and confirm it follows the instructions and lists the connector's tools; confirm the agent is refused when asked to edit `config/`.
- Create a second workspace in "Marketing"; confirm separate scratch dirs, memory and notes; delete it.
- Add a plain folder; create a workspace; confirm it works in the folder.
- Repeat the session check in a project with one repo that has its own `CLAUDE.md` and `.mcp.json`: both sets apply.
- No schema change is planned, so no migration.

## Completion verification

- 164 tests passed with the server suite run serially; lint and TypeScript checks passed. The existing notebook-watcher test intermittently misses events in parallel full-suite runs.
- Real Claude SDK connector precedence/connection and Codex connector discovery/tool-call checks passed without paid model turns.
- HTTP smoke tests in an isolated memory-only app covered project creation, instructions, masked connector round trips, non-git workspace creation/deletion, and rendered settings/workspace pages.
- Read-only Supabase checks confirmed the existing repo-less columns. This work requires no new migration and changed no remote schema.
- Interactive browser checks were unavailable because the automation host was unavailable. Migration/cascade rehearsal and live model instruction-following/write-denial checks were not performed.
