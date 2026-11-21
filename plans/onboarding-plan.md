# Light onboarding: a first-run intro, teaching empty states, and one-time hints

Status: proposal · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-20

## Goal

Someone who knows coding agents and Git, but has never seen Thunk, can open it and within a few minutes: understand the Project → Workspace → Session hierarchy, know where context lives (Notes, Tasks, Routines, Vault), confirm an agent works, and run a first session. Nothing here slows down a returning user.

## Why

Thunk's vocabulary and map are not self-explanatory, and the first run has several places to get stuck:

1. **The map is a metaphor.** Planets, moons and satellites (or cities, farms and fields) stand for projects, workspaces and sessions. Nothing on screen says so.
2. **Context areas explain themselves unevenly.** Routines and the Inbox have good empty states. Notes and Tasks say "No notes yet." and "No tasks yet." The top-level Vault empty state says to add a project and nothing about what agents do with the Vault.
3. **Agents are bring-your-own, and failure is silent.** Sessions spawn the user's local `claude` or `codex`. `/api/models` reports a Codex error (`codexError`), but no component shows it, and nothing checks Claude at all. A missing or signed-out agent shows up as a failed first session.
4. **The one flow that makes Thunk different is invisible.** A response becomes a document you edit, comment on and send back. A new user sees a chat box and treats it as chat.

`PRODUCT.md` now names light onboarding as a goal and sets the limits: skippable, shown once, replayable from Settings, never in a returning user's way.

## Principles

- **Teach in place.** Prefer an empty state or an inline line of text over a modal. The intro is the only modal.
- **Once, then gone.** Every hint is dismissed with one click and does not return. One Settings entry replays everything.
- **Derived from real data where possible.** "Has no projects" and "has no sessions" decide what shows, so an existing install sees almost nothing new.
- **Plain terms.** Project, Workspace, Session, Notes, Tasks, Routines, Vault. Map words appear only when explaining the map.
- **Agent-neutral.** Copy says "agent", and names Claude and Codex only on the agent screen.

## Scope

### 1. Onboarding state

One small module, `lib/onboarding.ts`, plus a `useOnboarding` hook.

- State is a set of seen keys (`intro`, `map-legend`, `workspace-repos`, `first-document`, `harvest`, `checklist-dismissed`) stored in one cookie, `thunk.onboarding`, written the same way as `thunk.look` in `lib/look.ts`.
- A cookie, not `localStorage`: `npm run dev` picks a random port, and `localStorage` is per port while cookies are not. The server can also read it, so the intro renders without a flash.
- `seen(key)`, `markSeen(key)`, `resetAll()`.
- Existing installs: if the server finds at least one project and no cookie, it treats `intro` as seen. The author never sees the intro unless they replay it.

### 2. First-run intro (modal, three screens)

Shown on `/projects` when `intro` is unseen. Built on the existing `Dialog`. Next / Back, a "Skip" on every screen, three progress dots, Escape closes and counts as seen. Arrow keys move between screens.

| Screen | Title | Content |
|---|---|---|
| 1 | How work is organised | **Project**: a git repo or folder. **Workspace**: one task inside a project, in place or in its own git worktree. **Session**: one chat in a workspace. A small diagram shows the three nested, drawn in the current look, with the map word beside each plain term. |
| 2 | Where context lives | **Notes**: plans and notebooks that you and agents both read and write. **Tasks**: the work list; send a task to a session. **Routines**: agent sessions that start on a schedule or event. One closing line: agents read all of this, so write it down once. |
| 3 | Your agents and setup | Agent status rows (section 3). Two lines on configuration: project instructions and connectors live in project settings, and a `thunk.json` in the repo sets Setup and Run scripts and notebooks. Primary button: "Add your first project", which closes the modal onto the existing add-project panel. With projects present (replay), the button reads "Done". |

While the modal is open, the "Add your first project" panel underneath stays visible but inert.

Mobile: the same three screens in the existing `Drawer`, without the diagram.

### 3. Agent readiness

- New `GET /api/agents/status`: for each of Claude and Codex, returns `ready`, `missing` or `signed-out`, with a short message. Codex reuses `listCodexModels()` and its error. Claude needs a new cheap check (binary found, and credentials present if that can be read without starting a billed turn; otherwise it reports installed only). The exact check is decided at implementation by reading how `lib/agent/claude-driver.ts` starts the SDK. Cached briefly like the Codex model list.
- A shared `AgentStatus` component renders one row per agent: name, state, and for a failing agent the command that fixes it (install or log in) with a copy button and a "Check again" button.
- Used in three places: intro screen 3, a new "Agents" row in the Settings popover, and the model picker (`components/chat/model-select.tsx`), where an unavailable agent's models are disabled with the reason instead of failing on send.
- With no agent ready, the session composer shows the status inline above the prompt box.

### 4. Map legend

On `/projects` and on a project's map, a small dismissible legend in a corner when `map-legend` is unseen: three rows pairing each map mark with its plain term, for the current look. It also covers hollow marks for closed sessions. Dismissing it marks it seen; a "Legend" item in the Settings popover opens it again at any time.

### 5. Empty states that teach

Each gets one sentence on what the area is for, one on what agents do with it, and one primary action. Reuse `CivPanel` / `Empty` as each screen already does.

| Screen | Today | Change |
|---|---|---|
| Notes (`notes-library.tsx`, `note-list.tsx`) | "No notes yet. Start one at the top level, or in a project or workspace." | Add: notes are plans and reference that agents can read and write. Button: New note. Mention repo notebooks once, linked to project settings. |
| Tasks (`task-list.tsx`, `task-board.tsx`) | "No tasks yet." | Add: a task is a piece of work you can send to a session; agents can create and update them. Keep the title input as the action, with the ⌘↵ hint. |
| Routines (`routines-overview.tsx`) | Good explanation already. | Add one line: routines fire only while Thunk is running. Offer two or three starter templates in the new-routine form (for example a daily PR summary). |
| Vault (`vault-overview.tsx`, `item-list.tsx`) | "Your Vault is empty … Add a project first." / "Nothing stored yet." | Say what it is for (docs, screenshots, transcripts agents can read). Per-project empty state points at the dropzone. |
| Inbox (`inbox.tsx`) | Good explanation already. | When desktop alerts are off, add a "Turn on desktop alerts" button that runs the same flow as Settings. |
| Projects map | "Add your first project" panel. | No copy change. The intro hands off to it. |

Templates for routines are the only new behaviour in this section; the rest is copy and one button.

### 6. First workspace and first session

- **New workspace** (`new-workspace-button.tsx`): when `workspace-repos` is unseen, a short note above the repo picker explains the choice the form offers (which repos the workspace includes, and what "shared in place" versus a separate worktree means for the user's checkout). Shown once.
- **First session composer** (`prompt-box.tsx`): when the project has no sessions, show three starter prompts as chips above the input, for example "Explain how this repo is organised", "Plan a change to …", "Find something worth fixing". A chip fills the input; it does not send.
- **First document** (`document-card.tsx`): the first time a response document appears and `first-document` is unseen, a one-line callout on the card: edit it, select text to comment, then send your revisions back. Dismissed on first interaction with the document.

### 7. Harvest hint

The first time a user archives or deletes a workspace that has memory or notes, and `harvest` is unseen, the confirm dialog gains one line explaining that Harvest keeps what the workspace learned in the project, with a button that opens the existing `harvest-dialog.tsx`. Shown once.

### 8. Getting-started checklist

A small collapsible card above the sidebar footer (`app-sidebar.tsx`), and on the mobile project list:

1. Add a project
2. Create a workspace
3. Run a session
4. Write a note
5. Create a task or routine

Each item is ticked from real data through one `GET /api/onboarding/progress` (counts only), and links to where it is done. The card disappears when all five are done or when dismissed (`checklist-dismissed`). It never shows on an install that already has all five.

### 9. Settings

The Settings popover (`settings-menu.tsx`) gains:

- **Agents**: opens the agent status rows.
- **Show intro**: replays the modal.
- **Legend**: shows the map legend.
- **Reset hints**: clears the onboarding cookie so every one-time hint and the checklist can appear again.

## Out of scope

- Step-by-step guided tours with spotlights.
- Sample or demo data in a real install. (`plans/dev-anywhere-plan.md` covers demo data for development.)
- Accounts, sign-up, analytics or tracking of onboarding completion.
- Installing or logging in to agents on the user's behalf. Thunk reports the state and shows the command.
- Documentation site or video.

## Phases

Each phase ships on its own.

1. **State, intro, agent readiness, Settings entries** (sections 1, 2, 3, 9). The intro depends on the agent status rows.
2. **Empty states and map legend** (sections 4, 5). Mostly copy.
3. **First workspace, first session, first document** (section 6).
4. **Checklist and Harvest hint** (sections 7, 8).

## Testing

- Unit: `lib/onboarding.ts` cookie parsing, `seen` / `markSeen` / `resetAll`, and the "existing install counts as seen" rule.
- Unit: agent status mapping from Codex and Claude check results to `ready` / `missing` / `signed-out`.
- Playwright (`e2e/`), on the memory-only setup the suite already uses:
  - Fresh install shows the intro; Skip and Escape both dismiss it; reload does not show it again.
  - "Add your first project" on screen 3 lands on the add-project form.
  - An install with a project and no cookie does not show the intro.
  - "Show intro" and "Reset hints" in Settings work.
  - Legend dismisses and stays dismissed.
  - Checklist ticks as a project, workspace and note are created, and disappears when dismissed.
- Both looks and both themes checked by hand for the intro diagram and legend, plus the mobile drawer.

## Decisions

- **Tasks, not Issues.** The intro and all copy say Tasks, matching the app.
- **Claude readiness.** If there is no cheap, unbilled signal that Claude is signed in, the row reports "installed" only, and a failed first session links back to the Agents row.
- **Vault stays out of the intro.** Screen 2 lists Notes, Tasks and Routines. Vault is explained by its empty state.

## Open questions

1. **Starter prompts.** Fixed copy, or chosen by whether the project has a repo? Fixed is simpler and is the default here.
2. **Desktop app.** If the Electron build serves the UI from a fixed origin, the cookie works unchanged. Confirm when `plans/desktop-app-plan.md` lands.
