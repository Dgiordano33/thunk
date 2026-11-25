# Canvas as a first-class part of Thunk

## Context

Canvas (the board at `/{project}/canvas`, code in `components/board` and `lib/board`) works, but sits beside the app:

- It renders in its own `(board)` route group with a bare layout: no sidebar, only a back button.
- It is appended to the planet's section list with no count or state, and is absent from the sidebar.
- Its agent sessions are hidden (`isHiddenSession`), so Canvas activity shows nowhere outside the board.
- The agent's model is hardcoded to `claude-sonnet-5-5` in `lib/board/session.ts`.
- Nothing in the board UI links a card to a task, a note or a workspace session.
- `PRODUCT.md`'s vocabulary omits Canvas, and `components/canvas` is the chat document editor, not the Canvas.

Goal: Canvas behaves like a sibling of workspaces. You can see it, reach it, tell when its agent is working, choose its model, and move work between it and Tasks, Notes and sessions.

Not in this plan: mobile Canvas (stays desktop-only), moving board storage from disk to Postgres, real-time multi-user editing.

## Decisions

- **Canvas stays a full page, not a map panel.** A board needs the room. It moves into the workspace shell so it keeps the sidebar, the same as a workspace.
- **Canvases are shown as canvases, not as sessions.** The agent session stays hidden from session lists. Opening it as a chat would be a second, worse view of the same board. Its status is surfaced on the canvas entry instead.
- **Each canvas gets a path.** `/{project}/canvas/{boardId}`; `/{project}/canvas` stays the main canvas. `?session=` redirects.

## Phase 1: Shell and navigation

| Change | Files |
|---|---|
| Move the page into the shell route group; delete the `(board)` layout. Keep `sky-surface` and `h-dvh overflow-hidden` on the board's own wrapper | `app/(board)/[project]/canvas/page.tsx` → `app/(shell)/[project]/canvas/[[...board]]/page.tsx` |
| `canvasPath` returns `/{slug}/canvas/{boardId}`; redirect `?session=` to it | `lib/routes.ts`, `lib/routes.test.mjs`, the page |
| Sidebar: a "Canvas" group under each project listing its canvases, with a "New canvas" action. Load names with `listCanvases` | `components/layout/app-sidebar.tsx`, the sidebar tree loader, `lib/board/service.ts` |
| Board header: drop the back button and the canvas tab strip (the sidebar now does both); keep the title, rename and "New canvas" | `components/board/board-view.tsx` |
| Planet section and town building use `canvasPath`, and show the canvas count | `components/town/town-page.tsx`, `components/town/town-view.tsx` |
| Mobile project home: keep "Desktop only", unchanged | none |

Check first: `ShellPanels` wraps children in `overflow-y-auto`. The board must own its scroll and gestures, so confirm it can fill the pane without a second scroller. Read the route-group and optional catch-all pages in `node_modules/next/dist/docs/` before moving files (`AGENTS.md`).

## Phase 2: Activity and model

| Change | Files |
|---|---|
| `listCanvases` returns each canvas's agent status (idle, running, waiting) by looking up `board.agent.sessionId` in the live session registry | `lib/board/service.ts`, `lib/board/types.ts` |
| Sidebar entry and planet section show that status; the section sets `attention` when a canvas is waiting on you | `components/layout/app-sidebar.tsx`, `components/town/town-page.tsx` |
| Store `model` in `board.json`. `ensureBoardSession` starts with `board.model`, else `env.DEFAULT_MODEL`. Remove the hardcoded Sonnet | `lib/board/session.ts`, `lib/board/store.ts`, `lib/board/types.ts` |
| Model picker in the board header, reusing `ModelSelect`. Changing it saves to the board and calls the existing `setModel` session control when a session is live | `components/board/board-view.tsx`, `components/chat/model-select.tsx`, `lib/board/routes.ts` |

Note: the Codex driver's `setModel` is a no-op, so a Codex canvas picks up a model change on its next session start. Say so in the picker's hint.

## Phase 3: Cross-links

| Change | Files |
|---|---|
| Deep link to a card: `?card={id}` centres and focuses it | `components/board/board-view.tsx`, `lib/routes.ts` |
| Card toolbar gains a menu: **Create task**, **Save as note**, **Start session from card** | `components/board/board-item.tsx`, `components/board/board-ui.tsx` |
| Create task: `createTask` with the card title and markdown, plus a link back to the card. Toast with a link to the task | `app/api/tasks/route.ts`, `lib/tasks/service.ts` |
| Save as note: write the card markdown to the project's notes, with the same back link | `app/api/projects/[id]/notes/route.ts` |
| Start session: open `newChatPath` for the main workspace with the card as the first prompt. The new-chat page reads only `model` today, so add a prefill | `app/(shell)/[project]/[workspace]/new/page.tsx`, `components/workspace/new-chat.tsx` |
| Reverse direction: Tasks and Notes get "Add to Canvas", which adds a doc card to the main canvas | `components/tasks`, `components/notes`, `lib/board/routes.ts` |

Check first: how Tasks and Notes store a source link today (`createTask` takes `createdInSessionId`; there is no generic source field). If none fits, put the back link in the body rather than add a column.

## Phase 4: Names and docs

| Change | Files |
|---|---|
| Add Canvas to the vocabulary list and describe it | `PRODUCT.md` |
| Update the Canvas sections for the shell move | `design.md`, `README.md` |
| Rename `components/canvas` → `components/document` and `CANVAS_PROMPT` → `DOCUMENT_PROMPT`. Mechanical, its own PR | `components/canvas/*`, importers in `components/chat`, `components/comments`, `lib/agent/options.ts` |

## Tests

- `lib/routes.test.mjs`: new `canvasPath` shape, `?session=` redirect.
- `e2e/canvas-sessions.spec.ts`, `e2e/canvas.ts`: new URLs; switch canvases from the sidebar; create one from the sidebar.
- `e2e/navigation.spec.ts`, `e2e/routes.spec.ts`: sidebar stays present on Canvas; planet section shows the count.
- New `e2e/canvas-links.spec.ts`: card → task, card → note, card → session, task → card, `?card=` focus.
- Unit test for the model fallback in `ensureBoardSession`.
- Run the existing gesture suites (`touch`, `keyboard`, `stacks`, `media`) after Phase 1, since the board's container changes.

## Order

One PR per phase, in order. Phase 1 fixes most of the "left over" feel on its own. Phases 2 and 3 are independent of each other once 1 lands. Phase 4's rename goes last so it does not conflict with the others.
