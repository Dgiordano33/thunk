# Repo notebooks: plans and task boards from the repository

Status: proposal · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-08

> **Where the implementation landed.** The first implementation of this plan shipped in commit `d6a33da`, squash-merged under the unrelated title "Style shared buttons with bronze and parchment colors (#17)". Its second squashed commit, "Add repo notebooks with live editing and task write-back", is the repo-notebooks work. Search for that commit, not for "repo notebooks", when reading the history. The follow-up described under "Post-ship review fixes" below came in a later commit.

## Goal

Many repos already carry their own agent planning material: plans in `.claude/plans/` or `docs/`, and a task board in `.claude/tasks/`. Today Thunk's Notes and Tasks live beside the repo under `~/.thunk`, so that material is invisible to the Library, to the brief composer in the orchestration plan, and to the Tasks tab, even though agents read and edit it constantly.

This plan makes those folders first-class notebooks. A project registers folders from its repo (primary or any extra repo); each shows up in the Library as a notebook, is readable and editable in the note editor, streams changes over the existing SSE feed, can be selected in an orchestration brief, and feeds checklist items into Tasks through the existing import path. Nothing is copied: the files in the repo stay the single source of truth, and git stays the history.

Non-goals for v1: bidirectional task sync beyond status, editing frontmatter that Thunk does not own, nested folders, non-markdown files, and importing a repo folder *into* `~/.thunk`. Each is listed under "Later".

## Decisions

Decision: **repo notebooks read from the main checkout, never a worktree.** Plans and boards describe the project's intent across branches, so the Library shows `project.root/<folder>` (or `extraRepo.path/<folder>`). A session running in a worktree still sees its branch's copy through its own file tools, like any other repo file; the Library and the brief see main. This matches how `readLifecycleConfig` already reads `thunk.json` only from the registered root.

Decision: **import, do not mirror.** A repo folder becomes a notebook by reference. Thunk never writes a copy under `~/.thunk`, and the orchestration brief references notes by scope and id as it does today. "Send to notebook" from a repo note is an ordinary copy the user asks for, not a sync.

Decision: **notes are the object above tasks.** A task board file is a note. Its unchecked items become tasks through `importNoteTasks`, each with a `noteId` back-link, exactly like checklist imports from `~/.thunk` notes today. The one new behavior is that completing a linked task checks the box in the file, so the board on disk stays truthful for agents that only read the repo.

Decision: **filename is the note id.** The store's `ID` pattern (`/^[a-z0-9][a-z0-9_-]{0,63}$/i`) already admits human filenames like `orchestration-plan`. No renaming on disk.

Decision: **repo notebooks have no memory file.** `MEMORY.md` stays a `~/.thunk` concept. A repo notebook's listing has no pinned memory row.

## Why this is tractable

- **One seam.** `NoteDirs` in `lib/notes/store.ts` is the only thing between "a folder of markdown" and a notebook. `listNotes`, `readNote`, `writeNote`, `deleteNote`, `tasksOf`, the SSE feed, the Library, the editor, the prompt block, and the task import are all written against it.
- **Tolerant parsing.** `parseNote` falls back to defaults when frontmatter is missing or partial, and `noteTitle` falls back to the first heading or the id. Existing plan files parse as-is.
- **Scopes are already an abstraction.** `NoteScope`, `scopeKey`, and `parseScopeKey` in `lib/notes/types.ts` are the only places that know the two scope kinds. The Library, the editor keys, and the URL (`/notes?scope=…`) use `scopeKey` strings.
- **Multi-repo exists.** `project_repos` and `ProjectRepo` give each extra repo a stable id and a main-checkout path.
- **The import path exists.** `noteImportCandidates` and `importNoteTasks` in `lib/tasks/service.ts` derive stable task ids from note id plus text and skip ones already imported. `tasks.note_id` is `text`, so repo filenames fit.
- **The orchestration plan wants this.** Its brief is "selected tasks + selected notes + instructions", resolved server-side through `dirsForScope`. A third scope kind flows through unchanged.

## Architecture

```
project_repo_folders row ─── { projectId, repoId | null, path: ".claude/plans", label }
        │
        ▼
NoteScope { kind: "repos", id: <folder id> }
        │  dirsForScope → NoteDirs { notesDir: <main checkout>/<path>, memoryFile: null }
        ▼
listNotes / readNote / writeNote  ──►  Library folder  ·  note editor  ·  SSE "changed"
        │
        ├──► orchestration brief (notes: [{scope, id}])
        └──► importNoteTasks → tasks (note_id = filename) ──► complete task → setTaskDone in file
```

## Workstreams

Ordered by dependency. Each is independently mergeable and leaves `npm run dev` and `npm run test:notes` passing.

### 1. Third scope kind and store changes

- `lib/notes/types.ts`: `NoteScopeKind` becomes `"projects" | "workspaces" | "repos"`. `scopeKey` emits `r:<id>`; `parseScopeKey` accepts it. Add `RepoNotebook = { id, projectId, repoId: string | null, repoName, path, label }` and extend `NoteFolder` with `repos: { notebook: RepoNotebook; notes: NoteMeta[] }[]`. `NoteMeta` gains `readonly source: "thunk" | "repo"` so the UI can badge rows without re-deriving from the scope.
- `lib/notes/store.ts`: `NoteDirs.memoryFile` and `memoryTitle` become optional. `listNotes` skips the memory row when `memoryFile` is undefined. `readNote` and `writeNote` return `null` for `MEMORY_NOTE_ID` in a memoryless scope. `createNote` in a repo scope requires an explicit `id` (the filename) instead of `newNoteId()`, validated by `ID`, and refuses to overwrite. `countNotes` stops adding `1` for memory when there is none.
- `lib/notes/frontmatter.ts`: `serializeNote` must preserve unknown frontmatter keys (a plan file may carry `status:` or `owner:` that Thunk does not model). Today it rebuilds the block from `NoteFrontmatter` alone. Parse into a `Map<string, string>` of raw lines, overwrite only the keys Thunk owns, and emit the rest in original order. Add tests for round-tripping unknown keys and a file with no frontmatter (none is added unless the user sets a flag).
- Writes stay atomic (`atomicWrite` is already rename-based), which matters more inside a repo where an editor or agent may be reading at the same time.

Acceptance: `npm run test:notes` passes with new cases for memoryless scopes, filename ids, unknown frontmatter keys, and no-frontmatter files.

### 2. Data model and resolution

- Migration `0007_repo_notebooks.sql`:
  - `project_repo_folders`: `id uuid pk`, `project_id` (fk cascade), `repo_id uuid null` (fk `project_repos` on delete cascade; `null` means the primary repo), `path text` (relative, normalized, no `..`, no leading slash), `label text`, `created_at`, `updated_at`; unique `(project_id, repo_id, path)` with `repo_id` coalesced for the primary repo; RLS and `set_updated_at` like `0006`.
  - No change to `tasks`. `note_id` already holds the filename.
- `lib/projects/types.ts`: `Project.repoFolders: RepoFolder[]`. `lib/supabase/repo/projects.ts` loads them with `extraRepos`, with the same in-memory fallback the other repos have.
- `lib/notes/resolve.ts`: `repoNoteDirs(project, folder)` returns `{ scope: { kind: "repos", id: folder.id }, notesDir: path.join(checkoutRoot, folder.path) }` where `checkoutRoot` is `project.root` for the primary repo or the matching `ProjectRepo.path`. Guard with `realpath` that the resolved dir is inside the checkout, mirroring `copyWorkspaceFiles`. `dirsForScope` handles `"repos"` and 404s when the folder row or its repo is gone. Add `notesDirsFor(project, workspace)` → also returns `repos: NoteDirs[]` so sessions and the prompt block can list them.
- Routes: `GET/POST /api/projects/[id]/repo-folders` (`{ repoId?, path, label? }`; validates the path, requires the directory to exist or offers to create it), `DELETE …/repo-folders/[folderId]` (unregisters only; never deletes files). Notes routes: `app/api/repos/[id]/notes` and `…/notes/[noteId]` built from `notesCollection("repos")` and `noteItem("repos")` in `lib/notes/routes.ts`; `PATCH` rejects `MEMORY_NOTE_ID` for this kind.
- `lib/client/api.ts`: `listRepoFolders`, `addRepoFolder`, `removeRepoFolder`; the existing note helpers take the new scope kind.
- Discovery: `POST /api/projects/[id]/repo-folders/suggest` scans each checkout for `.claude/plans`, `.claude/tasks`, `docs`, and `plans` containing at least one `.md`, and returns candidates not yet registered. Used by the project page and when a GitHub repo is cloned through `POST /api/projects/[id]/repos`.
- `thunk.json`: optional `"notebooks": [".claude/plans", ".claude/tasks"]` in `readLifecycleConfig`'s schema. On project load, entries present in the file but not in the table are registered (not the other way round), so a repo can declare its own notebooks and every Thunk install picks them up.

Acceptance: register `.claude/plans` on a project, `GET /api/repos/<id>/notes` lists its files with titles from headings, `PATCH` edits the body and leaves unknown frontmatter intact, `git diff` shows only the intended change.

### 3. Live updates

- `lib/notes/watch.ts` is rooted at `~/.thunk/projects` and maps paths by slug. Add a second watcher set keyed by folder id: one `fs.watch` per registered repo folder (non-recursive; v1 folders are flat), with the same debounce, retry, and `changed`/`removed` emission. `refreshSlugs` grows a `refreshFolders` sibling that rebuilds the set when folders are added or removed, called from the folder routes.
- Events carry `scope: { kind: "repos", id }` so `useNotesFeed` and the editor's `noteRev` keys work unchanged.
- Git operations rewrite many files at once (checkout, pull, rebase). Debounce per folder, not per file, at 300 ms so a branch switch yields one list refresh.

Acceptance: edit a plan file in an external editor or let an agent edit it in the main workspace; the Library row and open editor refresh without reload. Run `git checkout` of a branch that changes the folder; one refresh.

### 4. Library and editor

- `app/api/notes/route.ts`: each `NoteFolder` includes `repos`, loaded through `repoNoteDirs` alongside project and workspace notes.
- `components/notes/library-folders.tsx`: under each project, after its workspaces, a row per repo notebook labelled `<repo name> / <path>` (primary repo: just `<path>`), with a small "repo" badge in the muted style the workspace rows use. Selecting it sets `scope=r:<id>` in the URL.
- `components/notes/note-list.tsx` and `notes-library.tsx` ("All notes"): rows from repo scopes show a path chip; the label map adds `r:` entries.
- `components/notes/note-editor.tsx` and `note-meta-bar.tsx`: in a repo scope, the id is shown as the filename and is editable only at creation; the pin, inject, and tag controls still write frontmatter (Thunk-owned keys), with a one-line note that this edits the file in the repo. Delete asks for confirmation that names the path and says it removes the file from the working tree.
- New note in a repo scope: a filename field (slugified from the title by default) instead of an auto id.
- Project page (`/p/[id]`): the Library building gains a "Repo notebooks" section listing registered folders, the suggest results as one-click "Add", and a path input for anything else.

Acceptance: a project with `docs/` registered shows `docs/orchestration-plan.md` as "Orchestration: one brief, many workers" in the Library, opens in the editor, and saves back to the file.

### 5. Sessions and prompt

- `lib/notes/prompt.ts`: `loadSessionNotes` also lists repo notebooks. `notesPrompt` adds a "Repo notebooks" subsection: `- <label> (\`<path>\`, in the repo, main checkout)` plus the per-note index lines, so agents know these are tracked files and that the worktree may hold a different version. `inject: true` still works and counts against `INJECT_LIMIT`.
- `lib/agent/options.ts`: no `additionalDirectories` entry is needed for the primary repo (it is the cwd or the worktree's base), but a repo folder in an extra repo's main checkout is outside the worktree when the workspace checks that repo out separately; add its dir to `additionalDirectories` in that case so the agent can read main's copy.
- Both repo and `~/.thunk` notes appear in the brief composer from the orchestration plan with no further change, since it selects by `scopeKey`.

Acceptance: a session's system prompt lists the repo notebooks; an agent asked to "update the plan" edits the file in its own checkout; the Library reflects it once merged or when working in `main`.

### 6. Task boards: import and write-back

- `lib/tasks/service.ts`: `noteImportCandidates` takes repo notebooks into account. Items from repo notes are project-scoped (`workspaceId: null`) because the folder is read from main. The candidate id hash already keys on `noteId` + text, so repo items get stable ids too.
- `components/tasks/import-notes.tsx`: the import banner's count includes repo board items and names the folder ("12 items in `.claude/tasks`").
- Write-back: when a task with `noteId` pointing at a repo note transitions to `done` or `cancelled`, call `writeNote(dirs, noteId, { task: { line, text, done: true } })`. Find the line by text match (the existing `NoteTaskPatch` carries `line` and `text`; `setTaskDone` should verify the text at that line and fall back to a search so a moved line is still found). On reopen, uncheck. This runs in `lib/tasks/service.ts` after `updateTask`, is best-effort, and logs rather than fails the status change if the file changed underneath.
- Direction rule: the file wins for existence (a line removed from the board does not delete the task; the task keeps its link and shows "not in board"), Thunk wins for status within one session of edits. Document this in the README.
- A board file with headings per column (`## Todo`, `## In progress`, `## Done`) is still just checklist items in v1. Column awareness is in "Later".

Acceptance: import from `.claude/tasks/board.md`, complete a task in the Tasks tab, `git diff` shows `- [ ]` → `- [x]` on that line and nothing else.

### 7. Later

- Column-aware boards: map `## Open` / `## In progress` / `## Done` headings to statuses and move lines between sections on status change.
- Nested folders (`docs/plans/2026/…`) with recursive watching.
- Branch picker in the Library for a repo notebook (show a worktree's copy read-only).
- "Promote to repo": move a `~/.thunk` note into a registered folder, preserving id as filename.
- Routines that run when a board file changes on `main` (the `fs.watch` feed is already an event source candidate).
- Reading frontmatter the repo defines (`status`, `owner`) into note badges via a per-folder mapping.

## Changes to existing code (summary)

- `lib/notes/types.ts`: third scope kind, `r:` keys, `RepoNotebook`, `NoteFolder.repos`, `NoteMeta.source`.
- `lib/notes/store.ts`: optional memory, explicit ids on create, memoryless counts.
- `lib/notes/frontmatter.ts`: preserve unknown keys; `setTaskDone` text verification.
- `lib/notes/resolve.ts`: `repoNoteDirs`, `dirsForScope("repos")`, repo dirs in `notesDirsFor`.
- `lib/notes/watch.ts`: per-folder watchers.
- `lib/notes/prompt.ts`, `lib/agent/options.ts`: repo notebooks in the prompt block and extra-repo dirs.
- `lib/notes/routes.ts` + `app/api/repos/[id]/notes/**`: routes for the new kind.
- `app/api/projects/[id]/repo-folders/**`: register, remove, suggest.
- `lib/projects/types.ts`, `lib/projects/lifecycle-config.ts`, `lib/supabase/repo/projects.ts`: `repoFolders`, `thunk.json` `notebooks`.
- `lib/tasks/service.ts`: repo notes in import candidates, status write-back.
- `components/notes/*`, `components/tasks/import-notes.tsx`, project page: UI.
- `supabase/migrations/0007_repo_notebooks.sql`.
- README: Notes section gains "Repo notebooks" and the task write-back rule.

## Risks

- **Editing tracked files from the UI.** A save writes into the user's working tree on `main`. Mitigation: atomic writes, the editor's existing conflict check (`NoteConflictError`) against mtime, and a visible "in repo" badge. No auto-commit; git stays the user's.
- **Frontmatter churn.** Rewriting a plan's frontmatter would make noisy diffs. Mitigation: workstream 1 preserves unknown keys and never adds a block to a file that had none unless a flag is set.
- **Worktree drift.** The Library shows main while an agent edits a branch copy. Mitigation: the prompt block says so; "Later" has a branch picker.
- **Large `docs/` folders.** A docs site folder could hold hundreds of files. Mitigation: flat folders only in v1; the suggest step shows the file count before registering; `INJECT_LIMIT` already caps prompt size.
- **Watcher count.** One `fs.watch` per folder is cheap on macOS and Linux; `fs.watch` recursive is not used.

## Sequencing and estimate

1. Workstreams 1 and 2 together (store, resolve, migration, routes): the core, about two days.
2. Workstream 4 (Library and editor) next so the feature is visible: one day.
3. Workstream 3 (watchers) and 5 (prompt): half a day each.
4. Workstream 6 (task import and write-back): one day including tests.

Total: roughly a week of focused work, mergeable after each step.

## Open questions

- Should registering a folder be per project (shared across every workspace, as drafted) or should a workspace be able to add its own? Drafted: project only.
- When a repo note is selected for an orchestration brief, should the brief snapshot its content or reference the live file? Drafted: reference, consistent with `~/.thunk` notes.
- Should `thunk.json` `notebooks` be the only registration path, so the setup is committed and portable, with the UI writing to that file? Drafted: table plus file, file wins for additions.

## Post-ship review fixes

A review of the first implementation turned up these issues, now fixed:

- **Project getters had side effects.** `getProject`, `getProjectByRoot`, and `listProjects` read `thunk.json` from every checkout and could insert folder rows on every call. They are now pure: one query for the project and one for its folders (`listProjects` fetches every project's folders in a single query). Declared notebooks are reconciled by `reconcileDeclaredFolders` in `lib/notes/folders.ts`, which runs at project load (`addProject`), when a repo is added (`addProjectRepo`), when a folder is registered, and on the watcher's tick.
- **The repo watcher polled every 5 seconds.** The rescan in `lib/notes/watch.ts` now runs every 60 seconds as a safety net. A folder watcher that sees its own directory renamed or removed, which is what git does on checkout, triggers a re-watch about a second later.
- **Repo scope lookups scanned every project.** `dirsForScope({ kind: "repos" })` now loads the folder with `getRepoFolder(id)` and then its one project.
- **Title edits added frontmatter silently.** For a repo note with no `title:` key, the meta bar now says that renaming adds one.
- `noteImportCandidates` no longer fetches the project twice.

