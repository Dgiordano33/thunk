# Settings as a screen

Status: proposed · Date: 2026-11-22

## Goal

Replace the Settings popover with a `/settings` screen, like Inbox, Notes, Routines and Vault. It has to hold what is there today, the agent setup work in this branch, and the Slack and Linear settings from `plans/linear-slack-plan.md`.

## What is wrong today

`components/ambient/settings-menu.tsx` is a 256px popover holding ten unrelated things.

| Problem | Detail |
|---|---|
| No structure | Two selects, a toggle, three onboarding actions and a collapsed checklist of 19 alert kinds share one flat list |
| Dialogs on a popover | Usage and Agents each open a dialog from the popover. Agents now holds status, a toggle, a sync button and a sync report in a `max-h-[70vh]` box |
| Nothing says where a setting lives | Theme, look, desktop alerts and muted kinds are per browser (`localStorage`, cookie). Agent setup is per server (`~/.thunk/config/agents.json`). On the Droplet that difference matters and is invisible |
| Settings are scattered | Notes triage schedule is in the Notes sidebar. API keys are in the Mac app's Connections window, which a remote server never shows |
| No room to grow | Slack needs a token, destination, kinds and a test button. Linear needs a key and a team per project. Neither fits a popover |
| Not linkable | Nothing can deep-link to a setting (an Inbox "agent not signed in" notice, the onboarding checklist, docs) |
| Rendered three times | Sidebar footer, world toolbar and the mobile More sheet each mount it, with its usage polling and dialogs |

## Design

A `/settings` route in the `(world)` group, drawn in the same `CivPanel` frame as Routines (`max-w-5xl`, header, scrolling body). Left rail of sections, content on the right. Each section is its own URL: `/settings/[section]`, with `/settings` redirecting to the first.

Mobile: `/settings` is the section list; a section is a pushed page with the existing `MobileTopBar` back button.

### Sections

| Section | Contents | Source |
|---|---|---|
| **Appearance** | Theme as three preview swatches (System, Light, Dark). Look as two picture cards (Solar system, Game world) with the "always dark" note on the card | Moved from popover |
| **Notifications** | Desktop alerts switch with the browser's permission state and the fix when blocked. Alert kinds grouped (Needs you, Sessions, Routines, Delivery) with a per-group toggle. Later: a Slack column beside Desktop | Moved; grouping is new |
| **Agents** | One card per agent (Claude, Codex): ready or not, the command to fix it, Check again. Then **Your setup**: the `claudeUserConfig` switch, what is loaded here, Sync from this Mac and the last-sync report shown open, not in `<details>` | `AgentStatus`, `AgentSetup` from this branch |
| **Integrations** | Slack and Linear cards: connected or not, token field (never shown back), destination, Send test. Empty until Phase 1 of the integrations plan lands | New, from `linear-slack-plan.md` |
| **Automation** | Notes triage schedule (also stays reachable from Notes) | `TriageSettings` |
| **Usage** | Total, a bar chart by day, table by workspace. Full height instead of a `max-h-80` dialog | Moved from dialog |
| **Help** | Show intro, Map legend, Reset hints, each with a line saying what it does. Version, server host, storage mode | Moved; About is new |

### Rules for every section

- A scope label under each section title: **This browser** or **This server (`<host>`)**. One section never mixes both without labelling the rows.
- One row pattern: label and one-line description on the left, control on the right. Built once as `SettingRow` and `SettingSection`.
- Changes save on change, with an inline "Saved" or the error beside the control. No Save buttons except for token fields.
- Works in both looks. The world look needs a gear pixel icon in `components/world/pixel-icon.tsx`.

### Entry points

- The toolbar's Settings row becomes a link styled like the other five slots, with a detail such as "Agents ready" or "1 needs setup".
- Sidebar footer and the mobile More sheet link to `/settings`.
- `⌘,` opens it. The command palette gets "Settings" plus one entry per section; "View usage" goes to `/settings/usage`.
- `AgentStatus onlyUnavailable` and the onboarding checklist link to `/settings/agents`.

## Steps

### PR 1: the screen, no new behaviour

1. Read `node_modules/next/dist/docs/` on dynamic segments, layouts and redirects (per `AGENTS.md`).
2. Add `"settings"` to `RESERVED_SLUGS` in `lib/routes.ts`. Check whether any existing project already has that slug; if so, a migration renames it.
3. `app/(world)/settings/layout.tsx` (frame and rail), `app/(world)/settings/[section]/page.tsx`, `app/(world)/settings/page.tsx` (redirect).
4. `components/settings/`: `settings-shell.tsx`, `setting-row.tsx`, and one file per section. Move code out of `settings-menu.tsx`; reuse `AgentStatus`, `AgentSetup`, `TriageSettings`, `useDesktopAlerts`.
5. Replace `SettingsMenu` in `civ-toolbar.tsx`, `app-sidebar.tsx` and `mobile/tab-bar.tsx` with a link. Delete `settings-menu.tsx` and `usageOpen` from `ambient-store.ts`; update `ambient-hub.tsx`.
6. `CivToolbar` already collapses on `/notes`, `/vault`, `/inbox`; add `/settings`.
7. Drop the card borders inside `AgentSetup` and `AgentStatus` now that the section provides the frame.

### PR 2: make each section good

1. Appearance: swatches and look cards.
2. Notifications: permission state, grouped kinds. Add a `group` to each kind in `lib/notifications/types.ts`.
3. Usage: day chart, sortable workspace table, date range.
4. Help: version and server info from a small `GET /api/server/info`.
5. `⌘,` and command palette entries. Deep links from the checklist and Inbox.

### PR 3: Integrations

Lands with Phase 1 of `linear-slack-plan.md`. That plan's step 6 ("Settings UI") becomes the Slack card here, and the Slack kinds become a second column in Notifications.

## Not doing

- Syncing browser settings (theme, look, muted kinds) to the server. Label the scope instead.
- Per-project settings. Those stay in `components/town/project-settings.tsx`.
- Moving the Mac app's Connections window into the web UI. Link to it from Agents when `window.thunkDesktop` exists.
- A search box over settings. Seven sections do not need one.

## Open questions

- Keep a one-click theme switch in the toolbar menu, or is `/settings/appearance` enough? The plan assumes the screen only.
- Does Usage belong in Settings, or as a sixth toolbar slot? The plan keeps it in Settings because it is checked rarely.
- Should muted alert kinds move to the server so the Droplet and the Mac agree, once Slack delivery needs a server-side list anyway? Likely yes, in PR 3.
