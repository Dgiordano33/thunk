# Thunk design guide

This guide captures the implemented homepage and town styling. Use it when extending the interface, including canvas and chat screens. The source files linked below are authoritative for exact values; guidance for new work is identified separately from existing behavior.

## Visual direction

Thunk presents coding work as a map you can move around. There are two looks, chosen in **Settings → Look** and stored in the `thunk.look` cookie (see [lib/look.ts](lib/look.ts)). The root layout puts `look-space` or `look-world` on `<html>`, and the server reads the cookie to decide which map to render.

- **Solar system** (default, `look-space`): a clean star chart. Projects are planets around a star, workspaces are moons, sessions are satellites. Near-black space or white chart paper, hairline frames, plain sans-serif type and softly shaded spheres. Light and dark both work.
- **Game world** (`look-world`): a small strategy-game world. Projects are cities, each project a town with workspaces as farms and sessions as fields. Bronze frames, pixel lettering, stepped sprites and terrain. Always dark (the moonlit palette).

Both looks share every panel, form and route. Game words (Town hall, Workshop, Farmhouse, crop stages) appear only on the game map; panels, menus and empty states use the plain product terms in both looks. Keep the map treatment in navigation, headings, map objects and status cues, and give dense working content room to breathe.

In Tailwind, `space:` and `world:` variants target one look (defined in `app/globals.css`). Style for the solar-system look first and add `world:` classes for the game look, as [Button](components/ui/button.tsx) and the main menu do. CSS that belongs to one look is prefixed with `.look-space` or `.look-world`.

## Color and themes

Colors live in [app/globals.css](app/globals.css). Three families work together:

- **Application tokens:** `background`, `foreground`, `card`, `popover`, `muted`, `border`, `input`, `ring`, `primary`, and `destructive`. Use their Tailwind classes for content, forms, and interactive states. `:root` holds the white palette and `.dark` the near-black one, both cool neutrals (hue ~255, very low chroma). The game look overrides them with the moonlit palette on its screens.
- **Space tokens:** `--void` (map background), `--orbit` (orbit lines), `--star-core` / `--star-glow`, and status colors `--status-running`, `--status-attention`, `--status-error`, `--status-ok` (each with a `-soft` tint). Use the status tokens, through `StatusBadge` or the `.satellite` / `.status-*` classes, rather than Tailwind palette colors.
- **World tokens:** `--w-*` properties for terrain, bronze framing, parchment, roads, and soil, used by the game look. In the solar-system look the bronze and parchment tokens are remapped to neutrals, so older screens that reference them still read as plain selected and hover states; don't use them in new work.

Solar-system values:

| Token | White | Dark |
| --- | --- | --- |
| `--background` | `0.985 0.003 250` | `0.13 0.015 260` |
| `--void` | `0.97 0.004 250` | `0.09 0.012 262` |
| `--foreground` | `0.16 0.015 260` | `0.97 0.005 250` |
| `--muted-foreground` | `0.45 0.02 255` | `0.72 0.02 255` |
| `--border` / `--orbit` | black at 13% / 16% | white at 13% |
| `--ring` | `0.5 0.14 245` | `0.78 0.11 235` |

Representative game-world values:

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--w-sea` | `0.4 0.09 248` | `0.24 0.06 258` | Full-screen map background |
| `--w-ocean` | `0.47 0.1 245` | `0.32 0.07 255` | Deep water |
| `--w-grass` | `0.66 0.15 135` | `0.48 0.11 140` | Grassland |
| `--w-plains` | `0.76 0.12 100` | `0.58 0.09 95` | Open land |
| `--w-forest` | `0.52 0.12 145` | `0.38 0.09 150` | Forest floor |
| `--w-road` | `0.7 0.07 70` | `0.5 0.05 70` | Town roads |
| `--w-soil` | `0.48 0.07 55` | `0.36 0.05 55` | Farm soil |
| `--w-bronze` | `0.62 0.1 70` | `0.55 0.08 70` | Frame midtone |
| `--w-bronze-light` | `0.82 0.1 85` | `0.72 0.09 85` | Frame highlight |
| `--w-bronze-dark` | `0.42 0.08 60` | `0.32 0.06 60` | Frame edge and shadow |
| `--w-parchment` | `0.95 0.035 85` | `0.26 0.02 70` | Warm informational surface |
| `--w-parchment-ink` | `0.28 0.04 60` | `0.92 0.03 85` | Text on parchment |

Terrain also has alternate fills and detail colors for waves, trees, hills, rock, snow, and cliffs. Reuse the existing pairs for variation. Shared sprite materials such as wood, stone, straw, and gold are defined in [pixel-parts.tsx](components/world/pixel-parts.tsx); some artwork colors are fixed rather than theme tokens.

World variables are defined on `:root` and overridden by `.dark`, so portalled hover cards and popovers inherit them. Do not move them exclusively under `.world`. The theme supports light, dark, and system preferences; [lib/theme.ts](lib/theme.ts) applies the choice before paint.

## Typography

Fonts are loaded in [app/layout.tsx](app/layout.tsx).

| Typeface | Hook | Use |
| --- | --- | --- |
| Geist | `font-sans` / default | Body text, forms, chat, document prose |
| Geist Mono | `font-mono` | Code, paths, technical values |
| Pixelify Sans | `.pixel`, game look only | Map labels, HUD navigation, panel headings, short badges |

In the game look the `.pixel` class sets Pixelify Sans, `image-rendering: pixelated` and `shape-rendering: crispEdges`. In the solar-system look it does nothing, so headings marked `.pixel` render in Geist. Apply it selectively; long-form content should retain the normal text face.

Existing sizes establish this hierarchy:

- Eyebrows: 11–12px, uppercase, wide tracking, muted color.
- Map nameplates: 12px with 16px line height; small level badges use 12px bold.
- Supporting text and metadata: 11–12px; ordinary explanatory copy: 14px.
- HUD names and navigation: 14–16px; town panel titles: 18px with tight leading.
- First-project heading: 24px; undiscovered-section heading: 30px.

Use `tabular-nums` for counts and comparable numeric values. Truncate names and paths where the existing compact layouts require it.

## Surfaces and controls

### Panel frame

[CivPanel](components/world/civ-panel.tsx) is the shared frame for HUD groups, legends, hover cards, empty states, and project panels. Its look comes from CSS:

- **Solar system:** a 1px `border` hairline, 12px radius, `popover` glass with a 14px backdrop blur and a soft shadow. `parchment` looks the same as the default.
- **Game world:** the bronze frame below.

- A 3px bronze gradient frame runs from highlight through midtone to dark edge.
- Corners have 6px notches; the inner body has corresponding smaller notches.
- A hard downward shadow and fine inset edges give the frame depth.
- The default body uses `popover` and `popover-foreground`.
- The `parchment` prop switches the body to the warm parchment and ink tokens.
- `className` controls the outer frame; `bodyClassName` controls inner layout and spacing.

Use the default body for working controls and longer content. Existing explanatory hover cards and empty states use parchment. Preserve the notched silhouette instead of adding rounded card chrome around it.

Portalled map cards remove the underlying primitive's surface with `rounded-none bg-transparent p-0 shadow-none ring-0`, then render a `CivPanel` inside. City cards are 288px wide; town cards are 256px wide, with 12px inner padding.

### Buttons and icons

Map controls use the shared `CONTROL_BUTTON` from [IsoViewport](components/world/iso-viewport.tsx): a 32px square, 16px icon, muted hover background, and visible 2px focus ring. The town panel close control follows the same treatment.

Use [Button](components/ui/button.tsx) for ordinary form actions. It already supplies variants, sizing, disabled styling, and focus states. Its default height is 32px. In the solar-system look the default variant is a plain `primary` ink button with medium corners; its `world:` classes give the game look's bronze-on-soil plate.

[PixelIcon](components/world/pixel-icon.tsx) supplies castle, scroll, and hourglass artwork in the game look and the matching Lucide line icon in the solar-system look; CSS picks one, so it works in server components. Lucide icons handle functional controls such as zoom, back, information, and close. The main menu button is a deliberate circular exception with the dotted Thunk mark: a 48px glass circle in the solar-system look, a 56px bronze orb in the game look. The Thunk logo and mark stay the same in both looks.

### Which component library

Two libraries are in use, by rule rather than by habit:

- **shadcn** (`components/ui/`) everywhere by default. Before hand-rolling a control, check for a shadcn component: `alert-dialog`, `context-menu`, `checkbox` and `label`, `skeleton`, `kbd`, `empty`, `tooltip`, `sonner`, and the rest of `components/ui/`. Add one with `./node_modules/.bin/shadcn add <name>`, not `npx shadcn` or an npm script: those pass npm's own config (like a global `allow-scripts`) to the install the CLI runs, and npm 12 refuses it. Never pass `--overwrite` without reviewing the diff: it also rewrites registry dependencies, such as the customized `button.tsx`. If the CLI adds a package, pin it like the rest of package.json.
- **UI SDK** only where it adds behavior shadcn doesn't have: the Canvas board (gestures, and its controls in `board-ui.tsx`) and the workspace file tree (`Tree`: one tab stop, arrows, type-to-find, lazy folders).

Ask and tell with [`confirm()`](components/confirm.tsx) and `toast` from `sonner`, never `window.confirm`, `window.alert` or `window.prompt` (the canvas doc toolbar asks for a link in place, inside its menu). A destructive question passes `destructive: true`: a red action, and focus starts on Cancel. Errors toast with a short title and the error as the description.

Use [`Hint`](components/hint.tsx) (a tooltip, with an optional key) for icon buttons, status marks and actions. A plain `title` is still right for revealing the full text of a truncated name, like a tab or a path. A status mark that is only a glyph or dot also gets an accessible name.

## Solar-system map

[SystemMap](components/space/system-map.tsx) and [PlanetView](components/space/planet-view.tsx) draw the default look; the layout maths is pure and tested in [lib/world/system.ts](lib/world/system.ts) and [lib/world/planet.ts](lib/world/planet.ts). Both reuse `IsoViewport` for pan, zoom, keys and click-versus-drag.

- **All projects:** a star in the middle and tilted orbit ellipses (`TILT` 0.58). Projects fill rings oldest first and take an angle from their id, so a planet never moves when another is added. Planet size follows the city level (workspaces × 2 + sessions, thresholds 2, 6, 14, 30); sizes 3+ get faint bands, 4+ a ring. Colour is one of eight mostly cool palettes chosen by id. Light comes from the star.
- **One project:** the project planet in the middle opens the overview. Active workspaces are moons on rings of 4, 8, 12, with `main` first; each shows its branch and PR mark. Up to 12 newest sessions per moon are satellites on two dashed loops; the rest are counted as `+N`. Satellites grow with spend (thresholds $0.01, $0.5, $2, $5); closed sessions are hollow. Notes, Tasks, Routines, Vault and Canvas are a pill-shaped section bar at the bottom centre.
- **Spheres:** [Sphere](components/space/sphere.tsx) is one SVG: a radial body gradient lit from one side, a thin rim, a soft glow (kept faint on white), optional bands and ring. Dormant projects drop the glow and lose most of their colour.
- **Labels:** plain Geist, 13px names, 11px meta, with a halo in `--void` so they stay readable over orbit lines.
- **Background:** `.space` (and `.world`, `.fog` in this look) is `--void` with a sparse star field in dark, a faint 28px dot grid in white. It does not pan.

| State | Solar-system cue |
| --- | --- |
| Running | Green pulsing halo (static under reduced motion); green satellite; “● Running” badge |
| Needs attention | Amber “! Needs you” badge; amber satellite |
| Error | Red “× Error” badge; red satellite |
| Idle 30+ days | Dim, unlit planet and “Idle …” |
| Dev server running | Green dot after the moon's name |

Every state pairs a glyph and a word with its colour.

## Homepage composition

The [world layout](app/(world)/layout.tsx) fills `h-dvh`, clips overflow, and places the map under a shared HUD in both looks. The homepage has no project sidebar.

| Layer | Placement and spacing |
| --- | --- |
| Map | Full viewport; panned and zoomed as one stage |
| Title | Top-left bronze frame; 16px outer inset; 12px horizontal and 8px vertical body padding |
| Actions | Top-right bronze frame; compact group with 4px padding |
| Main menu | Bottom-left; 16px inset; expandable menu above the orb |
| Zoom and legend | Bottom-right; vertical bronze-framed control column |
| Empty state | Centered parchment panel, `max-w-sm`, 24px padding |

The HUD and map controls use `z-20`; the command menu and town panels use `z-30`. World objects use their own depth order inside the map stage. Overlay containers allow pointer events through empty space and enable them on actual controls. Keep future overlays from blocking map interaction outside their bounds.

Bottom controls use `bottom-18` during development to clear development tooling and `bottom-4` otherwise. Menu links are 224px wide, with 40px icon wells. The active section has a bronze-tinted background and bronze outline; Notes shows its note count; Routines shows how many are enabled. Any future unavailable section should carry an explicit “Soon” label.

## Game look: town styling

[TownView](components/town/town-view.tsx) reuses the homepage terrain, viewport, framed cards, and label treatment. The Town center represents the project, farmhouses represent workspaces, and fields represent sessions and their spend-based crop stage. The library opens the project's notebook; the workshop opens the project's routines (standing orders) and shows the amber `!` when a routine run waits on approval; the vault opens the project's uploads, lights its lamps while Claude is reading, and shows the amber `!` when an upload failed.

Inside a project, the HUD replaces the homepage title with a back link (“Projects”, or “World” in the game look) and the project name. Selecting an object opens a panel through a query parameter, retaining the surrounding map context and camera position.

[TownPanel](components/town/town-panel.tsx) defines the detail surface both looks share:

- Top offset: 80px. Right inset: 16px.
- Default width: `min(460px, calc(100vw - 2rem))`.
- `medium` width: `min(560px, calc(100vw - 2rem))`, for tabbed panels like the project overview.
- `wide` width: `min(720px, calc(100vw - 2rem))`.
- Panels with many sections use [PanelTabs](components/town/panel-tabs.tsx): a line-variant tab bar under the header, active tab in `?section=`, each tab scrolling on its own.
- Default height fills the available space down to the bottom inset.
- `compact` sizes the panel to its content, for short informational panels.
- Header: 16px horizontal and 10px vertical padding, bottom border, optional eyebrow and actions, close control.
- Content scrolls inside the frame with `min-h-0` and `overflow-y-auto`.

Escape normally closes a town panel, but yields to input fields and nested dialogs or menus. Chat can opt out with `escapable={false}` because Escape interrupts a turn. Preserve that distinction when adding panels.

## Notes

Notes follow Apple Notes' shape: notebooks → list → editor. The `/notes` Library is one full-height `CivPanel` under the HUD with three panes; the town Library is a `wide` `TownPanel` with list + editor and a notebook switcher; the workspace Notes tab lists notes and opens them in a wide right `Sheet`.

- Pane headers use small `.pixel` uppercase eyebrows. Note titles and bodies stay in Geist: the title is a 24px bold input, the body uses `.doc-prose` (including `- [ ]` checklists).
- List rows match `SessionsList`: `bg-background rounded-lg border`, a 13px title, an 11px time and excerpt line, and lucide badges for pinned, injected (brain), memory (lock) and open tasks (`tabular-nums`).
- Selected notebooks reuse the toolbar's active treatment (bronze tint and outline). Parchment and the `quill` pixel icon appear only in the empty editor state.
- Flags (Pin, Inject into sessions, Actionable) are pressed-state toggle chips; the note's file path sits below them in 10px mono, like the old memory editor.
- Saving is automatic (800ms) with a footer status. An agent edit while the note is dirty shows an amber banner with "Load their version" / "Keep mine" instead of overwriting.

## Routines

Routines reuse the existing surfaces rather than adding new ones. The town Workshop is a `wide` `TownPanel` (list → `?routine=new|<id>` form plus run history); `/routines` is one centered `CivPanel` table under the HUD, with a parchment empty state like the undiscovered sections.

- Forms and tables use `components/ui/*`; trigger and flag toggles are the same pressed-state chips as note flags. `.pixel` stays on headings and eyebrows.
- Run status badges use the session header's palette: amber pulse for running, amber for “Needs you”, emerald for succeeded, red for failed, muted for cancelled and skipped.
- Sessions started by a routine show a “Routine · <name>” badge in the session header, the hourglass pixel icon in session lists, and “· Routine” in the field panel eyebrow.

## Inbox

The Inbox is a full-height `CivPanel` under the HUD. A narrow project rail uses the toolbar’s bronze selection treatment and amber attention counts; below the large-screen breakpoint it becomes a project picker in the header.

- Requests that need a decision get an amber left edge, a status icon, readable context, and a primary action. Details expand in place so permissions and plans can be inspected before acting.
- Earlier updates use quiet, divided rows instead of equally prominent cards. Pixel type stays on headings; titles, details, and timestamps use the body font.
- Empty views use a parchment bell and one clear next step. Loading skeletons stop on failure, which shows a retry state instead of an endless loading screen.
- Bulk actions live in the header menu. The scrollable content sits between a fixed header and a keyboard-shortcut footer; all controls remain available without hover.

## Vault

The Vault reuses the Notes shapes. The town Vault is a `wide` `TownPanel` titled “Holdings”: a narrow left pane (dashed drop zone with **Paste text**, search, item rows) and a detail pane; `/vault` is the same two-pane body inside one `CivPanel` under the HUD, with a project picker that also sets the upload target. The selected item is in `?item=` (`<projectId>/<itemId>` on `/vault` when browsing all projects).

- Item rows match note rows: a lucide kind icon, a 13px title, an 11px “time · size · file name” line, and either an idea count (lightbulb, `tabular-nums`) or a status badge.
- Status badges use the routine palette: muted for queued, amber pulse for “Reading”, emerald for ready, red for failed.
- The detail title is a 20px bold auto-growing field; the summary renders as `.doc-prose` markdown; tags are secondary badges. Ideas are bordered cards with an outline kind badge (bronze idea, sky insight, violet question, emerald action) and **→ Note** / **→ Task** buttons that turn into ghost links once used.
- The empty detail state is the only parchment surface, with the `chest` pixel icon.

## Game look: map artwork and states

The isometric tile is 64×32px. Use `toIso`, `mapSize`, and the grid types in [terrain.ts](lib/world/terrain.ts) for placement. Sprite ground lines align to tile centers; labels hang beneath the artwork. Cities use a 32×28 source grid rendered at 2×. Town buildings use larger source grids at the same 2× scale.

Build sprites from crisp SVG shapes and the shared materials in `pixel-parts.tsx`. Keep stepped roofs, stone foundations, timber details, small banners, and restrained ground shadows consistent with [town sprites](components/town/sprites.tsx). Project and workspace hues identify ownership through roofs, banners, and badges.

Map labels combine a colored badge with white text on a black/65 nameplate, a thin dark ring, and a hard 2px shadow. Focus adds a visible white ring. Hover lifts city artwork by 2px over 150ms.

Status uses more than color:

| State | Existing visual cue |
| --- | --- |
| Running city session | Chimney smoke; green in activity styling |
| Needs attention | Amber `!` badge |
| Session error | Red `!` badge |
| Dormant city | Desaturated, dimmed sprite and `zzz` |
| Unavailable section | Fog texture, parchment explanation, explicit placeholder copy |

The map legend explains population and activity cues; the town legend explains crop stages. Keep the legends aligned with the actual meaning of the artwork.

## Motion and access

Existing motion includes a spring-open command menu, small orb hover/press scaling, smoke, attention badges, and a 3.2-second wave opacity cycle. Camera movement is direct manipulation through the shared viewport. It supports drag, wheel zoom, arrow-key pan, plus/minus zoom, and `0` to fit. A drag must not activate the object beneath its release point.

New motion should stay brief and functional, with a static reduced-motion alternative. Waves and city smoke already respect reduced motion; toolbar and city attention animations do not explicitly do so, so do not assume that coverage is complete.

Use real links and buttons, accessible names for icon-only controls, visible keyboard focus, and textual status labels. Decorative SVGs remain `aria-hidden`. Keep long descriptions readable without pixel typography. Existing narrow-screen width caps are a starting point; verify HUD overlap and panel access on small viewports when extending these layouts.

## Canvas and chat guidance

For new canvas and chat work, carry the world identity through headings and surrounding navigation while using semantic application surfaces for editable content. Reuse existing form and editor components and use `TownPanel` when content belongs in the town overlay.

The current `.doc-prose` style in `app/globals.css` provides the document baseline: 15px body text, 1.7 line height, 0.75em block spacing, restrained heading tracking, underlined links, muted code surfaces, and bordered tables. Code blocks use 13px monospace with horizontal scrolling. Comment anchors have distinct default, active, resolved, and dark-theme styles; preserve these states.

Avoid introducing a second palette, a replacement frame, or pixel-styled body text for new editor screens. Keep bronze and parchment as meaningful accents around the work.

### Canvas board interactions

The Canvas board (`components/board/`) builds its gestures and controls on UI SDK (`@ui-sdk/core`, `@ui-sdk/react`, pinned to an exact beta). Keep every SDK call in two files so a beta change touches only them:

- `board-primitive.ts` defines the `board` primitive: pan and zoom (`createViewport`, 20%–200%), card moves (`createMove`, with stacked cards following), card widths and the focus outline (one `createResize`, the outline under the `@focus` key), and Shift-drag selection (`createLasso`). Gestures run on drafts and live styles, so a drag renders nothing until the drop, which writes the store once.
- `board-ui.tsx` styles UI SDK parts with `buttonVariants`: `BoardButton`, `BoardToolbar`, `BoardToggle`, `BoardSegmented`, `Hint` (a tooltip with its shortcut, used in place of `title`) and `Confirm` (a top-layer popover).

`use-board-primitive.tsx` connects the primitive to React; `lib/board/interaction.ts` holds the pure store mappings and is unit-tested. The zustand store stays the only durable state: the primitive is fed positions, boxes and focus ids, and reports changes back. Inside the world, size screen-constant chrome with `calc(Npx / var(--canvas-zoom))` rather than reading the zoom in React. The TipTap bubble menu and freehand drawing remain custom.

A card is placed by `left: var(--hold-x, <x>)` / `top: var(--hold-y, <y>)`: while it is dragged the primitive sets those to where the drag started, so a remote edit (an agent's board_op) that moves it, or restacks it, can't move it under the pointer. Window-level canvas keys yield to popups: an Escape that closes a tooltip, popover or dialog does nothing else, and Delete only acts when focus is on the canvas. On coarse pointers the picked card shows its grip, toolbar and width handle, since there is no hover.

`e2e/` covers these interactions in a browser (`npm run test:e2e`): stacks, chart and image cards, the outline, touch, edits landing mid-gesture, and keyboard. Run it after bumping UI SDK.

## Checks when extending the design

- Reuse `CivPanel`, `TownPanel`, `IsoViewport`, `Sphere`, `StatusBadge`, `PixelIcon`, and existing UI primitives where their roles match.
- Verify both looks, and the solar-system look in both light and dark, including portalled surfaces.
- Anything new on the map needs a version in each look; anything off the map uses plain terms.
- Check keyboard focus, Escape behavior, reduced motion, and map click-versus-drag behavior when touched.
- Check long names, empty states, small viewports, and content overflow.
- Keep unavailable features explicitly labeled and use current legends and status meanings.
- Read the relevant installed Next.js guide in `node_modules/next/dist/docs/` before changing application code, as required by `AGENTS.md`.

In the game look, the workspace shell opts into the moonlit palette through `.moonlit`; in the solar-system look it follows light and dark. Chat, documents, and code retain Geist and monospace on normal surfaces.
