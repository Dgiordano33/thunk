# Thunk design guide

This guide captures the implemented application styling. Use it when extending the interface, including canvas and chat screens. The source files linked below are authoritative for exact values; guidance for new work is identified separately from existing behavior.

## Visual direction

Two looks are chosen in **Settings → Appearance → Look** and stored in the `thunk.look` cookie ([lib/look.ts](lib/look.ts)). The root layout applies `look-space` or `look-vanilla` before paint. Solar system stays the default; saved `world` values migrate to Vanilla.

- **Solar system** (`look-space`): the existing star chart, planets, moons, satellites, twilight surfaces, and floating panels. Preserve its appearance and map interactions.
- **Vanilla** (`look-vanilla`): a quiet, conventional application. A persistent desktop sidebar has two levels ([VanillaSidebar](components/vanilla/sidebar.tsx)). The general level lists Projects, Inbox, Tasks, Notes, Vault, and Routines. Inside a project it lists that project's Inbox, Tasks, Notes, Vault, Routines, and Settings, then each workspace with its sessions nested and the project's canvases; **All projects** returns to the general level. Settings sits in the footer at both levels. A bar across the top of the window ([VanillaTopBar](components/vanilla/top-bar.tsx)) holds the logo, Search (`⌘K`) in the middle, and Relay on the right, so the sidebar starts at navigation; it carries no page title. Projects use a searchable list with live status. Project pages show workspaces and recent sessions; each project section is a full-size working pane reached from the sidebar, with no tab strip. No map, game sprites, sky, ambient animation, or movable windows.

Both looks use plain product terms and share routes, data, editors, and actions. Both support light, dark, and system appearance; phones keep their existing compact list navigation. Game world is retired. Remaining `world:` classes and terrain artwork are legacy implementation details, not a supported theme or a pattern for new work.

Use semantic application tokens and shared controls first. `space:` and `vanilla:` variants are for deliberate differences. Vanilla uses Geist, restrained spacing, subtle borders, plain Lucide icons, and meaningful status colors. A functional canvas remains a canvas in either look.

## Vanilla layout

[VanillaProjects](components/vanilla/projects.tsx) and [VanillaProject](components/vanilla/project.tsx) replace the maps. The `(world)` route layout reuses `AppSidebar` and `ShellPanels` for desktop Vanilla, including saved sidebar sizes. A slim breadcrumb bar keeps direct visits navigable; the Projects list is the top level and has none, since its heading already names it. On a phone the sidebar sheet keeps the logo, Search, and Relay. Notes, Tasks, Routines, Vault, Canvas, and project settings stay reachable through the project level of the sidebar.

`FloatingWindow` renders a normal full-size pane in desktop Vanilla with no drag, resize, or maximize controls. `CivPanel` becomes an opaque card with an 8px radius and a 1px border. Existing project panels keep their content and close actions. Editors own their scroll within the available height. Keep long names truncated in lists and wrapped in page headings, preserve keyboard focus, and avoid page-level horizontal overflow.

Vanilla uses the neutral `:root` / `.dark` application palette. Legacy bronze and parchment variables are mapped to neutral tokens for shared selection states; do not add new uses of them. Empty states use a plain section icon and a clear next action. Shared status tokens continue to carry Running, Needs you, and Error, with text as well as color.

## Color and themes

Colors live in [app/globals.css](app/globals.css). Three families work together:

- **Application tokens:** `background`, `foreground`, `card`, `popover`, `muted`, `border`, `input`, `ring`, `primary`, and `destructive`. Use their Tailwind classes for content, forms, and interactive states. `:root` holds the white palette and `.dark` the near-black one, both cool neutrals (hue ~255, very low chroma). Vanilla uses these neutral values; Solar overrides them with its twilight palette.
- **Space tokens:** `--sky-top` / `--sky-bot` (the sky gradient), `--void` (the middle of the sky, for label halos and flat fills), `--orbit` (orbit dots, fallback art), `--star-core` (the star's ink), `--sp-meta` (mono metadata), `--sp-rule` (panel edges), `--ease-space` (the one UI easing curve), and status colors `--status-running`, `--status-attention`, `--status-error`, `--status-ok` (each with a `-soft` tint). Amber and red also have an `-ink`: `--status-attention-ink` for amber text (the fill is too light for text on white) and `--status-error-ink` for text on a red fill. The canvas reads the sky, star and orbit colours from `SKY` in [lib/world/bodies.ts](lib/world/bodies.ts); keep it in step with the CSS tokens. Use the status tokens, through `StatusBadge` or the `.satellite` / `.status-*` classes, rather than Tailwind palette colors.
- **Contrast on white:** small status text needs 4.5:1. Tailwind's amber, emerald, sky and green 600 shades fall short on white, so light-mode text uses the 700 shade (`text-emerald-700 dark:text-emerald-400`).
- **Legacy tokens:** `--w-*` variables are retained for older shared controls and mapped to each look's selection colors. Use application and status tokens in new work.

Solar-system values:

| Token | White | Dark |
| --- | --- | --- |
| `--background` | `0.985 0.003 250` | `0.13 0.015 260` |
| `--sky-top` → `--sky-bot` | `0.962 0.022 250` → `0.972 0.032 330` | `0.14 0.055 265` → `0.215 0.1 302` |
| `--void` | `0.967 0.027 290` | `0.175 0.078 284` |
| `--foreground` | `0.16 0.015 260` | `0.97 0.005 250` |
| `--muted-foreground` | `0.45 0.02 255` | `0.72 0.02 255` |
| `--border` | black at 13% | white at 13% |
| `--orbit` | ink `0.3 0.08 265` at 42% | `0.82 0.06 250` at 42% |
| `--star-core` | `0.62 0.15 70` | `0.93 0.11 95` |
| `--ring` | `0.5 0.14 245` | `0.78 0.11 235` |

## Typography

Fonts are loaded in [app/layout.tsx](app/layout.tsx).

| Typeface | Hook | Use |
| --- | --- | --- |
| Geist | `font-sans` / default | Body text, forms, chat, document prose |
| Geist Mono | `font-mono` | Code, paths, technical values |

The legacy `.pixel` class renders normal Geist text in both supported looks. Pixelify Sans is no longer loaded.

Existing sizes establish this hierarchy:

- Eyebrows: 11–12px, uppercase, wide tracking, muted color.
- Map nameplates: 12px with 16px line height; small level badges use 12px bold.
- Supporting text and metadata: 11–12px; ordinary explanatory copy: 14px.
- HUD names and navigation: 14–16px; town panel titles: 18px with tight leading.
- First-project heading: 24px; undiscovered-section heading: 30px.

Use `tabular-nums` for counts and comparable numeric values. Truncate names and paths where the existing compact layouts require it.

## Surfaces and controls

### Panel frame and controls

[CivPanel](components/world/civ-panel.tsx) is the shared surface. Solar uses ruled glass with a 14px radius, blur and a small shadow; Vanilla uses an opaque card, 8px radius and subtle border. `parchment` is retained for existing empty-state callers. `className` controls the outer frame and `bodyClassName` controls content layout.

Use [Button](components/ui/button.tsx) for form actions and Lucide icons for controls. [PixelIcon](components/world/pixel-icon.tsx) retains its historical name but now returns a plain line icon. Solar's circular main-menu button remains on map routes; Vanilla uses the sidebar.

### Which component library

Two libraries are in use, by rule rather than by habit:

- **shadcn** (`components/ui/`) everywhere by default. Before hand-rolling a control, check for a shadcn component: `alert-dialog`, `context-menu`, `checkbox` and `label`, `skeleton`, `kbd`, `empty`, `tooltip`, `sonner`, and the rest of `components/ui/`. Add one with `./node_modules/.bin/shadcn add <name>`, not `npx shadcn` or an npm script: those pass npm's own config (like a global `allow-scripts`) to the install the CLI runs, and npm 12 refuses it. Never pass `--overwrite` without reviewing the diff: it also rewrites registry dependencies, such as the customized `button.tsx`. If the CLI adds a package, pin it like the rest of package.json.
- **UI SDK** only where it adds behavior shadcn doesn't have: the Canvas board (gestures, and its controls in `board-ui.tsx`) and the workspace file tree (`Tree`: one tab stop, arrows, type-to-find, lazy folders).

Ask and tell with [`confirm()`](components/confirm.tsx) and `toast` from `sonner`, never `window.confirm`, `window.alert` or `window.prompt` (the canvas doc toolbar asks for a link in place, inside its menu). A destructive question passes `destructive: true`: a red action, and focus starts on Cancel. Errors toast with a short title and the error as the description.

Use [`Hint`](components/hint.tsx) (a tooltip, with an optional key) for icon buttons, status marks and actions. A plain `title` is still right for revealing the full text of a truncated name, like a tab or a path. A status mark that is only a glyph or dot also gets an accessible name.

## Solar-system map

[SystemMap](components/space/system-map.tsx) and [PlanetView](components/space/planet-view.tsx) draw the default look; the layout maths is pure and tested in [lib/world/system.ts](lib/world/system.ts), [lib/world/planet.ts](lib/world/planet.ts) and [lib/world/bodies.ts](lib/world/bodies.ts). Both reuse `IsoViewport` for pan, zoom, keys and click-versus-drag, opting into its `underlay`, `onView` and `smooth` props.

- **All projects:** a star in the middle and one planet per project, floating free: no orbit lines, and each planet bobs gently (3px, 5–9s, off under reduced motion). New projects start at a spot from `placePlanets` (oldest first, angle from the id, labels clear of each other via `LABEL_BOX`), so a planet never moves when another is added. Drag a planet, or focus it and press Alt + arrow keys, to move it; the offset from the star is saved in the `thunk.planets` cookie ([lib/world/positions.ts](lib/world/positions.ts)) so the server renders the same layout. Drops are clamped inside the map and away from the star, so the map never resizes under you. “Reset planet layout” appears in the control column once anything has moved. Planet size follows the city level (workspaces × 2 + sessions, thresholds 2, 6, 14, 30), radius 12, 17, 23, 30, 38. Colour is one of eight mostly cool palettes chosen by id. Light comes from the star, and follows a planet while it is dragged.
- **One project:** the core is the same planet as on the home map (its level and seed) at r=58; it opens the overview. Active workspaces are rock or ice moons on rings of 4, 8, 12, with `main` first; each shows its branch and PR mark. Up to 12 newest sessions per moon are satellites on two dotted loops; the rest are counted as `+N`. Satellites grow with spend (thresholds $0.01, $0.5, $2, $5); closed sessions are hollow. A fixed key light falls from the upper left, so every night side faces lower right. Notes, Tasks, Routines, Vault and Canvas are a ruled glass section bar at the bottom centre, counts in mono.

### Rendering

One WebGL2 canvas per map ([components/space/scene](components/space/scene)) draws everything pictorial: the sky gradient, a seeded field of specks and four-point sparkles in three parallax layers, orbits, the star, and every body. It sits behind the stage, is not panned, and applies the view itself. HTML stays on top for links, labels, focus rings, satellites and hover cards, so hit-testing, keyboard and screen readers don't depend on the canvas. A `SceneStore` passes view and hover by ref, so neither re-renders React.

The look is line art: outlines and hatching, no gradients on the bodies, no glows.

- **Bodies** are sphere impostors: one quad each, the shader rebuilds the normal per pixel, so surface lines turn with the planet and stay crisp at any zoom. Each is a disc tinted with its palette colour, an outline, and a night side in a lighter tint with diagonal hatching, bounded by the terminator line. Three inks per body and theme come from `bodyColors()`. Lines are a fixed share of the radius with a 1px floor.
- **Type follows size**, told by a few surface lines: rock (crater rims), ice world (coastlines and polar caps), cloud world (wandering streaks), gas giant (latitude bands, a ring), great giant (bands, a storm oval, a ring with a gap). Tilt, spin period and band count come from the id. Rings are edge lines with sky between them, passing behind and in front of the planet.
- **Star:** a solid core in a ring, on two nested four-point sparkles, outlines only. It breathes slowly.
- **Orbits** (project view): rows of evenly spaced dots, brighter on the near half; the hovered moon's orbit brightens.
- **Dark and light** share every shape. Dark draws light lines on dark tints; light draws ink lines on pale tints, and its stars are ink, gold and rose marks.
- **Dormant** bodies keep their drawing and lose their colour.
- **Fallback:** the server renders the same drawing as SVG ([Sphere, StarMark](components/space/sphere.tsx), `Orbits`) over the CSS sky. When the canvas has drawn a frame, `.space` gets `gl-ready` and the SVG fades out over 300ms. Without WebGL2, or after a lost context, the SVG stays.
- **Gallery:** `/mock/solar?gallery` and `/mock/solar-light?gallery` show every type × palette plus dormant bodies, for tuning.

### Type

| Element | Spec |
| --- | --- |
| Planet name | Geist 14/18, 600, tracking −0.011em (`.sp-name`) |
| Meta line | Geist Mono 10/14, 500, caps, tracking 0.08em, `--sp-meta` (`.sp-meta`): `9 WS · 22 SESS`, `IDLE 45D` |
| Core name | Geist 20/24, 600, tracking −0.02em, with a mono `PROJECT · <TYPE>` eyebrow |
| Moon | Geist 13/16, 500; branch in mono 10.5px |
| Status badge | Geist Mono 10px caps, tracking 0.06em, glyph + word, outlined in the status colour |
| Hover card | Mono eyebrow, name 15/600, stat rows with hairline dividers and tabular mono values ([card.tsx](components/space/card.tsx)) |

A 1px × 8px leader tick joins each body to its label. Labels keep a `--void` halo so they read over stars and orbits.

### Motion

One curve for UI: `cubic-bezier(0.22, 1, 0.36, 1)` (`--ease-space`, `ease()` in [lib/ease.ts](lib/ease.ts)).

- **Entrance** on mount (~1.1s): star blooms, orbits draw on from the front with an 80ms stagger, bodies scale 0.6→1 with a 40ms stagger, labels rise 6px. The CSS animation `space-clock` on `.space` is the shared clock, so the canvas stays in step even when WebGL starts late. `router.refresh()` doesn't remount, so it doesn't replay.
- **Hover/focus:** the body scales to 1.08 and its lines and orbit brighten (darken, in light); press is 0.97.
- **Camera:** fit, zoom buttons, keyboard zoom and double-click tween over 240ms; wheel and drag stay direct.
- **Ambient:** planet bob, surface spin, the star breathing, sparkles pulsing, star parallax. The renderer moves each planet's HTML twin with it (`translate`), so labels and hit areas stay on the body. 30fps when idle, full rate while panning, hovering or entering, paused when the tab is hidden.
- **Reduced motion:** a single static frame redrawn on pan, zoom and hover; the entrance is a 150ms fade; the camera jumps; hover changes brightness only; the running pulse is static.

| State | Solar-system cue |
| --- | --- |
| Running | Green pulsing halo (static under reduced motion); green satellite; “● RUNNING” badge |
| Needs attention | Amber “! NEEDS YOU” badge; amber satellite |
| Error | Red “× ERROR” badge; red satellite |
| Idle 30+ days | Grey planet, “IDLE 45D” meta |
| Dev server running | Green dot after the moon's name |

Every state pairs a glyph and a word with its colour.

## Screens outside the map

The solar-system look carries past the map to every screen: the workspace shell, the canvas, the Library, Inbox, Routines, Vault and every panel. It is done with shared tokens and a few classes, so screens pick it up without their own styling.

- **Surfaces:** in this look the application tokens (`background`, `card`, `popover`, `muted`, `accent`, `border`, `input`, `ring`, `sidebar-*`) are the twilight family rather than neutral grey: deep indigo in dark, dawn lavender in light (`:root.look-space` blocks in `app/globals.css`). Don't hard-code neutral greys on top of them.
- **Sky:** map routes and the `(world)` screens sit on `.world`, which paints the sky with its stars. The workspace shell (`ShellPanels`) and the canvas page add `.sky-surface`, the same gradient without stars. The canvas lives in the workspace shell, so it keeps the sidebar; its wrapper fills the content pane with `overflow-hidden`, so the board owns its scroll and gestures and the pane never scrolls under it. The sidebar is translucent so the sky shows through; dense content (console, editors, documents) stays on solid surfaces.
- **Accent:** `--sp-accent` (periwinkle) marks selection. The old `--w-bronze` and `--w-parchment` tokens point at it in this look, so `WORLD_SELECTION`, pressed toggles and the Inbox and Library rails read as accent tints.
- **Eyebrows:** `.pixel` eyebrows set in caps (`.pixel.uppercase`) render as 10px Geist Mono caps with 0.1em tracking, like the map's metadata. Headings keep Geist.
- **Empty states:** [`EmptyMark`](components/space/orbit-mark.tsx) shows the section's line icon on a small line-art planet in a dotted orbit, with two sparkles; Vanilla uses the plain icon. Parchment cards that aren't panels lose their fill in this look, so the mark and text sit straight on the panel.
- **404:** [app/not-found.tsx](app/not-found.tsx) uses the same empty-state frame.
- **Words:** empty states and panels use plain product terms in both looks ("No routines yet", "Your Vault is empty", "Back to your projects").
- **Sidebar** ([app-sidebar.tsx](components/layout/app-sidebar.tsx)): the logo row carries Search (`⌘K`); the Relay bar is the one field below it; then Inbox and Library rows, routine runs, and the project tree. The Inbox row shows the open action count as the attention mark; per-project marks link to the filtered Inbox, so the sidebar never previews notifications itself. Every row keeps one resting number on a shared right edge: attention (`! N`, `--status-attention-ink` on `--status-attention-soft`, mono) or open tasks on projects, session count on workspaces, item count on Inbox and Library. Row actions (notes, tasks, new workspace, workspace menu) join beside that number on hover or keyboard focus through `.sidebar-row` / `.sidebar-row-actions`, which hide them visually without leaving the tab order. Selection (`WORLD_SELECTION`) wraps the whole row, count included. Workspace icons name the kind only (house for Local, branch for a worktree); a worker session adds a small bot mark after the name. Each project's canvases ([sidebar-canvases.tsx](components/layout/sidebar-canvases.tsx)) follow its workspaces as the same rows (`components/layout/sidebar-row.ts`) with no heading: the shapes icon names the kind, and each canvas row reveals a new-canvas button the same way. An open canvas selects its own row, not the project's. Collapsed projects persist in `localStorage`. On desktop the whole sidebar collapses to a 52px icon rail (Search, Crack, Inbox with its count, Library, Settings, Expand) from the button beside Settings, ⌘\\, or dragging the handle past its minimum; the rail persists with the panel layout, and expanding returns to the last width ([shell-panels.tsx](components/layout/shell-panels.tsx), `useSidebarState`).

## Homepage composition

The [world layout](app/(world)/layout.tsx) fills `h-dvh`, clips overflow, and places the map under a shared HUD in both looks. The homepage has no project sidebar.

| Layer | Placement and spacing |
| --- | --- |
| Map | Full viewport; panned and zoomed as one stage |
| Title | Top-left glass frame; 16px outer inset; 12px horizontal and 8px vertical body padding |
| Actions | Top-right glass frame; compact group with 4px padding |
| Main menu | Bottom-left; 16px inset; expandable menu above the orb |
| Zoom and legend | Bottom-right; vertical glass-framed control column |
| Empty state | Centered parchment panel (glass in the solar-system look), `max-w-sm`, 24px padding |

The HUD and map controls use `z-20`; the command menu and town panels use `z-30`. World objects use their own depth order inside the map stage. Overlay containers allow pointer events through empty space and enable them on actual controls. Keep future overlays from blocking map interaction outside their bounds.

Bottom controls use `bottom-18` during development to clear development tooling and `bottom-4` otherwise. Menu links are 224px wide, with 40px icon wells. The active section has a muted background; Notes shows its note count; Routines shows how many are enabled. Any future unavailable section should carry an explicit “Soon” label.

## Shared project panels

Solar opens details beside its map. Vanilla displays the same panel within its project page, below the section navigation. Project and workspace preview URLs stay valid in both looks.

[TownPanel](components/town/town-panel.tsx) defines the detail content both looks share. The following floating dimensions apply only to Solar; Vanilla fills the available content pane:

- Top offset: 80px. Right inset: 16px.
- Default width: `min(460px, calc(100vw - 2rem))`.
- `medium` width: `min(560px, calc(100vw - 2rem))`, for tabbed panels like the project overview.
- `wide` width: `min(720px, calc(100vw - 2rem))`.
- Panels with many sections use [PanelTabs](components/town/panel-tabs.tsx) with `vertical`: a rail of line icons down the left (tooltip names, a small mono count badge for lists like sessions or archived workspaces), active tab in `?section=`, each tab scrolling on its own. Project and workspace panels share this shape: every tab opens on a `Section` heading, stat rows use `CardStats` (the hover card's hairline rows with mono values), and a panel's one primary action pins to a footer below the rail.
- Default height fills the available space down to the bottom inset.
- `compact` sizes the panel to its content, for short informational panels.
- Header: 16px horizontal and 10px vertical padding, bottom border, optional eyebrow and actions, close control.
- Content scrolls inside the frame with `min-h-0` and `overflow-y-auto`.

Escape normally closes a town panel, but yields to input fields and nested dialogs or menus. Chat can opt out with `escapable={false}` because Escape interrupts a turn. Preserve that distinction when adding panels.

## Notes

Notes follow Apple Notes' shape: notebooks → list → editor. The `/notes` Library is one full-height `CivPanel` under the HUD with three panes; the town Library is a `wide` `TownPanel` with list + editor and a notebook switcher; the workspace Notes tab lists notes and opens them in a wide right `Sheet`.

- Pane headers use small `.pixel` uppercase eyebrows. Note titles and bodies stay in Geist: the title is a 24px bold input, the body uses `.doc-prose` (including `- [ ]` checklists).
- List rows match `SessionsList`: `bg-background rounded-lg border`, a 13px title, an 11px time and excerpt line, and lucide badges for pinned, injected (brain), memory (lock) and open tasks (`tabular-nums`).
- Selected notebooks reuse the toolbar's active treatment (neutral tint in Vanilla, the accent in Solar). The empty editor state shows the `quill` mark: a plain icon in Vanilla, an orbit mark in Solar.
- Flags (Pin, Inject into sessions, Actionable) are pressed-state toggle chips; the note's file path sits below them in 10px mono, like the old memory editor.
- Saving is automatic (800ms) with a footer status. An agent edit while the note is dirty shows an amber banner with "Load their version" / "Keep mine" instead of overwriting.

## Routines

Routines reuse the existing surfaces rather than adding new ones. The town Workshop is a `wide` `TownPanel` (list → `?routine=new|<id>` form plus run history); `/routines` is one centered `CivPanel` table under the HUD, with a parchment empty state like the undiscovered sections.

- Forms and tables use `components/ui/*`; trigger and flag toggles are the same pressed-state chips as note flags. `.pixel` stays on headings and eyebrows.
- Run status badges use the session header's palette: amber pulse for running, amber for “Needs you”, emerald for succeeded, red for failed, muted for cancelled and skipped.
- Sessions started by a routine show a “Routine · <name>” badge in the session header, the repeat icon in session lists, and “· Routine” in the field panel eyebrow.

## Inbox

The Inbox is a full-height `CivPanel` under the HUD. A narrow project rail uses the current look’s selection treatment and attention counts (`--status-attention-ink` on `--status-attention-soft`, mono); below the large-screen breakpoint it becomes a project picker in the header. Project and kind filters live in the URL (`?projectId=`, `?kind=`); the kind picker lists only kinds present, with open counts.

The list has three sections, in this order ([model.ts](components/inbox/model.ts) decides which):

- **Decisions:** an agent is blocked until someone answers (permission, question, plan, chief plan, agent request, or anything carrying inline actions). Full cards with the one attention cue: a `--status-attention` left edge and a tinted icon well. The lead line is 15px; kind, project and time sit above it as muted metadata. Permissions show tool input in mono. Question options share one outline weight and cap at four inline; more go to the session. Plans lead with **Review plan**, which opens the plan as `.doc-prose`; approval appears only after that.
- **Follow-ups:** open action items an agent or a person can resolve elsewhere (failed or stuck CI, review requests, stuck sessions). One-line rows (min 44px) grouped by project, then kind, with a count and a group **Dismiss N**; groups past five rows fold behind “Show N more”. They clear themselves when the underlying problem is fixed.
- **Earlier:** resolved and informational items as quiet one-line rows; details expand in place.

Delivery rows lead with the PR title and carry the PR number as mono metadata, never the kind label twice. Every row has exactly one link out, named for where it goes (“Open PR on GitHub”, “Open preview”, “Open session”); external links open in a new tab.

- **Quick context:** any item that came from a session has a **Context** toggle (a labelled button on decision cards, an icon button on rows). It opens a panel in place ([quick-context.tsx](components/inbox/quick-context.tsx)): **From** (project › workspace › session, state, origin, model), **Asked to** (the session's first prompt), **Needs** (one sentence, in `--status-attention-ink` while the agent is blocked), **Lately** (recent tool calls in mono, files edited), then the last few messages. Only the newest message renders as Markdown; older ones are three-line plain previews. The server builds these from the session's events ([context.ts](lib/notifications/context.ts)), so they appear at once. A **Summary** row then arrives above them: two or three sentences written by a one-shot Claude call ([brief.ts](lib/notifications/brief.ts)) from the same digest, cached per state of the conversation (reading an item doesn't rewrite it). It shows a two-line skeleton while it is written, dims while a newer one replaces it, waits for a working agent to settle, and is simply absent when Claude can't be reached. While the agent is working the panel re-reads every few seconds, so its answer arrives without leaving the Inbox.
- **Reply:** the panel ends in a reply box, and decision cards carry **Reply** (or **Answer**, as the primary button, when a question has no inline options). What a typed reply does follows the request: it answers a pending question, denies a pending permission with the note, sends a pending plan back as requested changes, and is otherwise a message to the session (resumed first if paused). The send button says which. Questions with several parts or several picks get option toggles plus a write-in per question. Enter sends, Shift+Enter adds a line, Esc returns to the row.
- **Triage loop:** when a decision is answered (an inline option, a reply that answers it, or a dismissal), focus moves to the next decision in the order you saw them, with its context open, and the answered item's panel closes as it drops to Earlier. A reply that is only a message to the session doesn't move on. Inline options carry number keys (`1`–`4`, in button order, shown in each button's tooltip), so a run of decisions can be cleared from the keyboard. When none are left, the live region says so.
- **Permissions** offer **Allow for this session** between Allow and Deny when the agent suggested a rule, as the session view does; it scopes the rule to that session and writes nothing to settings files.
- **Session folding:** in Earlier, rows from one session fold under its newest, with a mono `+N` toggle (“Show N earlier updates from this session”) that unfolds them as indented rows. Rows with no session stand alone.
- **Header:** full eyebrow, heading and filters only when the view is empty; with items it collapses to one row (heading, status, filters, menu).
- **Dismissal:** every dismissal shows an Undo toast. The header menu dismisses what’s in the current project and kind view and says how many; when that includes decisions it asks first, and offers “Dismiss follow-ups only”.
- **Keyboard:** shortcuts work only while the list has focus. Rows use a roving tab stop (one per list; a row’s own controls are tabbable only when it’s active). `j`/`k` or arrows move, `x` or Space selects, `e` dismisses the row or the selection, `o` or Enter opens, `1`–`4` pick a decision's inline options, `c` toggles quick context, `r` opens it with the cursor in the reply box, Esc clears the selection. After a dismissal, focus lands on the row that took its place; a polite live region announces the result.
- **Controls:** 32px buttons and icon buttons, full-strength `ring` focus rings, distinct accessible names (“Dismiss “Fix flaky test””), tooltips via `Hint`. Nothing is hover-only.
- **States:** empty views use the bell mark (a plain icon in Vanilla, an orbit mark in Solar) and one clear next step. Loading skeletons stop on failure, which shows a retry state. A reconnect keeps the list in place and merges fresh rows over it.

## Vault

The Vault reuses the Notes shapes. The town Vault is a `wide` `TownPanel` titled “Holdings”: a narrow left pane (dashed drop zone with **Paste text**, search, item rows) and a detail pane; `/vault` is the same two-pane body inside one `CivPanel` under the HUD, with a project picker that also sets the upload target. The selected item is in `?item=` (`<projectId>/<itemId>` on `/vault` when browsing all projects).

- Item rows match note rows: a lucide kind icon, a 13px title, an 11px “time · size · file name” line, and either an idea count (lightbulb, `tabular-nums`) or a status badge.
- Status badges use the routine palette: muted for queued, amber pulse for “Reading”, emerald for ready, red for failed.
- The detail title is a 20px bold auto-growing field; the summary renders as `.doc-prose` markdown; tags are secondary badges. Ideas are bordered cards with an outline kind badge (bronze idea, sky insight, violet question, emerald action) and **→ Note** / **→ Task** buttons that turn into ghost links once used.
- The empty detail state shows the `chest` mark: a plain icon in Vanilla, an orbit mark in Solar.

## Motion and access

Solar's map motion remains as described above. Vanilla has no decorative motion; transitions should explain state changes. Use real links and buttons, accessible names for icon controls, visible keyboard focus, and textual status labels. Respect reduced motion and verify long names, empty states, narrow screens, and overflow.

## Canvas and chat guidance

For new canvas and chat work, use semantic application surfaces for editable content in both looks. Reuse existing form and editor components and use `TownPanel` when content belongs in the town overlay.

The current `.doc-prose` style in `app/globals.css` provides the document baseline: 15px body text, 1.7 line height, 0.75em block spacing, restrained heading tracking, underlined links, muted code surfaces, and bordered tables. Code blocks use 13px monospace with horizontal scrolling. Comment anchors have distinct default, active, resolved, and dark-theme styles; preserve these states.

Avoid introducing a second palette, a replacement frame, or pixel-styled body text for new editor screens. Use the current look’s neutral or twilight tokens around the work.

### Canvas board interactions

The Canvas board (`components/board/`) builds its gestures and controls on UI SDK (`@ui-sdk/core`, `@ui-sdk/react`, pinned to an exact beta). Keep every SDK call in two files so a beta change touches only them:

- `board-primitive.ts` defines the `board` primitive: pan and zoom (`createViewport`, 20%–200%), card moves (`createMove`, with stacked cards following), card widths and the focus outline (one `createResize`, the outline under the `@focus` key), and Shift-drag selection (`createLasso`). Gestures run on drafts and live styles, so a drag renders nothing until the drop, which writes the store once.
- `board-ui.tsx` styles UI SDK parts with `buttonVariants`: `BoardButton`, `BoardToolbar`, `BoardToggle`, `BoardSegmented`, `Hint` (a tooltip with its shortcut, used in place of `title`), `Confirm` (a top-layer popover) and `BoardMenu` (a top-layer menu, like a card's Create task / Save as note / Start session).

`use-board-primitive.tsx` connects the primitive to React; `lib/board/interaction.ts` holds the pure store mappings and is unit-tested. The zustand store stays the only durable state: the primitive is fed positions, boxes and focus ids, and reports changes back. Inside the world, size screen-constant chrome with `calc(Npx / var(--canvas-zoom))` rather than reading the zoom in React. The TipTap bubble menu and freehand drawing remain custom.

A card is placed by `left: var(--hold-x, <x>)` / `top: var(--hold-y, <y>)`: while it is dragged the primitive sets those to where the drag started, so a remote edit (an agent's board_op) that moves it, or restacks it, can't move it under the pointer. Window-level canvas keys yield to popups: an Escape that closes a tooltip, popover or dialog does nothing else, and Delete only acts when focus is on the canvas. On coarse pointers the picked card shows its grip, toolbar and width handle, since there is no hover.

`e2e/` covers these interactions in a browser (`npm run test:e2e`): stacks, chart and image cards, the outline, touch, edits landing mid-gesture, and keyboard. Run it after bumping UI SDK.

## Checks when extending the design

- Reuse `CivPanel`, `TownPanel`, `IsoViewport`, `Sphere`, `StatusBadge`, `PixelIcon`, and existing UI primitives where their roles match.
- Verify both looks in light and dark, including portalled surfaces.
- New map actions must also be reachable from Vanilla lists or panels; use plain terms throughout.
- Check keyboard focus, Escape behavior, reduced motion, and map click-versus-drag behavior when touched.
- Check long names, empty states, small viewports, and content overflow.
- Keep unavailable features explicitly labeled and use current legends and status meanings.
- Read the relevant installed Next.js guide in `node_modules/next/dist/docs/` before changing application code, as required by `AGENTS.md`.

In Vanilla, the workspace shell uses neutral surfaces; in Solar it sits on the sky (`.sky-surface`) with twilight surfaces, in light and dark. Chat, documents, and code retain Geist and monospace on normal surfaces.

### Thoughts

A quiet list of thoughts still under way (routing, queued, working) or needing a retry sits above the Inbox feed, only when there are any; new thoughts come from the Capture bar, not an Inbox field. A ready thought is a Decision: it sits in the Decisions list in time order with permissions and questions, shares the list's single tab stop and keys, and shows You said, Assumed, Did and Next. 1 Go ahead authorizes the named next step; 2 Redirect resumes the worker (a project tag moves the work); 3 Discard stops it and offers Undo; Keep closes it. A ready thought has no dismiss or select, so it can't leave the feed without one of those. The capture_ready notification is the row.

Capture also opens through its bar in the HUD top row (between the title and Search) or under the logo row in the sidebar, the in-app shortcut (Command/Ctrl+Shift+K by default), the mobile navigation button, and the desktop shortcut. Both shortcuts are recorded under Settings → Capture. The sent chip appears under the top bar. Dismissed drafts survive closing the bar. The desktop window is frameless and always on top, centred a third of the way down the screen with the pointer; on macOS it is a non-activating panel that floats over full-screen apps. Submission, Escape, blur or the shortcut again hides it.
