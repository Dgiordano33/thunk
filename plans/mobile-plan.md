# Mobile-friendly Thunk

## Context

Thunk is desktop-only today: no mobile layout exists, about 35 breakpoint classes in feature code, and both shells are fixed splits (map + floating panels, or sidebar | chat | tools). The home and project screens are pan/zoom maps whose details are hover-only, so on a phone you cannot see or reach most things.

Goal: on a phone you can list projects, open a project, list and enter workspaces, chat with sessions, and create/view notes and issues. The map, canvas board, code editor, terminal and diff review stay desktop-only.

Terms: "issues" are **Tasks** in code (`lib/tasks`, `components/tasks`). "Canvas" here means the board at `/{project}/canvas`; the document cards inside chat replies stay, since they are the replies.

Not in this plan: reaching Thunk from a real phone. `proxy.ts` rejects non-loopback hosts; that is Phase 1 of `plans/remote-access-plan.md`. This plan replaces that file's Phase 2 and can be built and tested with emulated viewports first.

## Approach

Same URLs, one codebase, a single breakpoint: below `md` (768px) is the mobile layout.

- **Layout is CSS** (`md:` classes) wherever both forms can share one tree.
- **Where the trees differ** (map vs list, resizable split vs single column) use a `useIsDesktop()` hook so only one mounts. It avoids mounting WebGL, xterm, CodeMirror and a second `SessionView` on phones.
  - New `ViewportProvider` in `components/providers.tsx`. Initial value comes from the request's user agent (read in `app/layout.tsx`), then `matchMedia('(min-width: 768px)')` via `useSyncExternalStore`. This keeps server and client output the same on first paint.
- No data code changes. Every screen reuses the existing loaders, stores and `lib/client/api.ts`.

## Shared pieces (build first)

| Piece | What it is | Files |
|---|---|---|
| Viewport meta | `viewport` export: `viewportFit: "cover"`, `interactiveWidget: "resizes-content"` so the composer stays above the keyboard | `app/layout.tsx` |
| Safe areas | `pb-safe` / `pt-safe` utilities using `env(safe-area-inset-*)` | `app/globals.css` |
| `MobileTopBar` | Back arrow, title, search, one primary action. Replaces `WorldHud` below `md` | new `components/mobile/top-bar.tsx`, `components/world/world-hud.tsx` |
| `MobileTabBar` | Bottom tabs: Projects, Inbox (with waiting count), Notes, More (Routines, Vault, Settings). Replaces `CivToolbar` below `md` | new `components/mobile/tab-bar.tsx`, `components/world/civ-toolbar.tsx` |
| Full-screen panels | `TownPanel` becomes a full-height page under the top bar below `md` instead of a floating card. One change covers the Library, Tasks, Routines, Vault and project overview panels | `components/town/town-panel.tsx` |
| `DesktopOnly` | Placeholder: "Open this on a larger screen", with a link back | new `components/mobile/desktop-only.tsx` |
| Touch rules | Hover-revealed controls become always visible below `md` (pattern already in `task-row.tsx:36`); 44px minimum tap targets; popovers stop forcing `side="left"/"right"`; keyboard-shortcut hint text hidden | `app-sidebar.tsx`, `workspace-panel.tsx`, `prompt-composer.tsx`, `inbox.tsx` |

## Screens

### 1. Projects — `/projects`
- Today: `SystemMap` (draggable planets, hover cards).
- Mobile: `ProjectList`, one card per project: name, workspace count, running/waiting dots, open-task and note counts. Tap opens the project. "Add project" in the top bar.
- Data: `loadSidebarProjects()` (`components/layout/sidebar-tree.ts`), `useAmbient`, `useTaskCounts`.
- Files: `app/(world)/projects/page.tsx`, new `components/mobile/project-list.tsx`.
- Limit: adding a project uses a macOS folder dialog on the host, so it will not work from a phone until the remote plan's folder picker lands. Hide the button below `md` until then.

### 2. Project — `/{project}`
- Today: `PlanetView` (moons, satellites, bottom dock) with floating panels.
- Mobile: `ProjectHome`, a scrolling page:
  1. Chief card (`ChiefPanel`).
  2. Workspaces list: name, branch, status dot, session count; "New workspace" button.
  3. Section rows: Notes, Tasks, Routines, Vault, each with its count. Canvas row shown as desktop-only.
  4. Overview and Settings (existing `ProjectPanel` tabs), External and Archived collapsed.
- `?ws=` opens the workspace detail as a full page (the `FarmPanel` content: Open workspace, New session, sessions list, notes).
- `?session=` on mobile goes straight to the full session route instead of the embedded `FieldPanel`.
- Files: `components/town/town-page.tsx`, `components/town/panels.tsx`, new `components/mobile/project-home.tsx`, `components/project/new-workspace-button.tsx` (popover → sheet below `md`).

### 3. Workspace — `/{project}/{workspace}/...`
- Today: sidebar | chat | tools, both splits resizable, plus a terminal footer.
- Mobile:
  - `ShellPanels` renders content only; `AppSidebar` opens in a left `Sheet` from the top bar.
  - `WorkspaceShell` renders a single column, no resizable group.
  - `WorkspaceTabs` becomes a compact header: back, current session title (tap opens a sheet with `SessionsList` and "New chat"), overflow menu with branch and PR status.
  - Tools open as a bottom `Sheet` with tabs Sessions, Artifacts, Tasks, Notes.
  - Hidden: Files, Changes/diff review, Checkpoints, the console/terminal, open-file tabs.
  - `/file/...` renders `DesktopOnly`.
- Files: `components/layout/shell-panels.tsx`, `components/workspace/workspace-shell.tsx`, `workspace-tabs.tsx`, `workspace-panel.tsx`, `workspace-console.tsx`, `app/(shell)/[project]/[workspace]/file/[...path]/page.tsx`.

### 4. Session and new chat
- `SessionView` already works standalone (it is mounted outside the shell in `FieldPanel`).
- Changes: `Timeline` and `DocumentCard` padding down to `px-4`; `PromptBox` pinned to the bottom with safe-area padding; model and permission selects collapse into one menu; Stop button always visible (Esc has no phone equivalent).
- Approvals (`PermissionCard`, `AskQuestionForm`, `PlanActions`) get full-width, touch-sized buttons.
- Documents are read-only on mobile; plan approve / request changes still work. Selection-based comments and the comments panel stay desktop-only.
- Files: `components/chat/timeline.tsx`, `prompt-box.tsx`, `prompt-composer.tsx`, `components/session/session-header.tsx`, `components/canvas/document-card.tsx`, `components/workspace/new-chat.tsx`.

### 5. Notes — `/notes`, `/projects/{p}/notes`, workspace Notes tab
- Today: notebooks | list (`w-64`/`w-72`) | editor side by side.
- Mobile: list → detail stack.
  - List is full width with a notebook `Select` on top (replaces the notebooks column) and the existing search and "+".
  - Opening a note (`?note=`) shows the editor full screen with a back arrow.
  - `NoteMetaBar` keeps Pin and Delegate/Route visible; Inject, tags and Delete move to an overflow menu.
  - Editing stays on: TipTap works on touch, autosave already exists.
- Create: unchanged (inline "Untitled" note, or the repo-note dialog).
- Files: `components/notes/notes-library.tsx`, `library.tsx`, `note-list.tsx`, `note-meta-bar.tsx`, `components/town/library-panel.tsx`, `components/workspace/workspace-notes.tsx`.

### 6. Tasks (issues) — `/projects/{p}/tasks`, workspace Tasks tab
- Closest to ready: one column already, row actions already visible on narrow screens.
- Changes: `TaskSheet` opens full width from the bottom; selects stack in one column; larger checkbox and row tap area; a visible "Details" button beside `NewTaskInput` (the ⌘↵ path has no phone equivalent).
- Files: `components/tasks/task-board.tsx`, `task-sheet.tsx`, `task-row.tsx`, `new-task-input.tsx`.

### 7. Inbox — `/inbox`
- Already partly responsive. Hide the keyboard-shortcut footer, enlarge action buttons, and make it a tab in `MobileTabBar` with the waiting count.
- Files: `components/inbox/inbox.tsx`.

### 8. Routines and Vault (lower priority)
- Routines: the 7-column table becomes cards below `md`. Vault: full-width project picker.
- Files: `components/routines/routines-overview.tsx`, `components/vault/vault-overview.tsx`.

### Desktop-only (show `DesktopOnly` or hide the entry point)
Maps (`SystemMap`, `PlanetView`, game look), board canvas `/{project}/canvas`, file editor, file tree, terminal, diff review, checkpoints, `/mock/*`.

## Order

1. Shared pieces.
2. Projects list, project home, workspace detail (screens 1–2).
3. Workspace shell and session view (3–4).
4. Notes, tasks, inbox (5–7).
5. Routines, vault, tests, and update Phase 2 in `plans/remote-access-plan.md` to point here.

Each step is shippable on its own; desktop is unchanged at `md` and up.

## Before coding

`node_modules` is not installed in this worktree. Run `npm install`, then read the `viewport` and `headers` guides under `node_modules/next/dist/docs/` (required by `AGENTS.md`; Next 16.2.4 differs from older versions).

## Verification

- Add a `mobile` Playwright project (iPhone 13 device) to `playwright.config.ts` and a new `e2e/mobile.spec.ts`:
  - projects list → project → workspace → new chat screen reachable by taps only;
  - create a note and see it in the list; create a task, open its details, mark it done;
  - `/{p}/canvas` and a `/file/...` URL show the desktop-only placeholder;
  - every visited page has no horizontal overflow (`scrollWidth <= innerWidth`).
- Existing desktop e2e (`npm run test:e2e`) still passes, including panel-resize persistence and the no-hydration-error check in `workspace-ui.spec.ts`.
- `npm run typecheck`, `npm run lint`, `npm test`.
- Screenshots at 375×812 and 768×1024 of each screen above, saved under `.context/`.
