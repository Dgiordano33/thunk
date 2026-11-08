# Thunk design guide

This guide captures the implemented homepage and town styling. Use it when extending the interface, including canvas and chat screens. The source files linked below are authoritative for exact values; guidance for new work is identified separately from existing behavior.

## Visual direction

Thunk presents coding work as a small, living strategy-game world. Projects are cities, workspaces are town centers, and sessions are farm fields. Bronze frames, pixel lettering, stepped sprites, and terrain give navigation its character. Inside those frames, ordinary sans-serif text and neutral surfaces keep forms, conversations, and documents readable.

Keep the game treatment concentrated in navigation, headings, map objects, and status cues. Give dense working content room to breathe. Use the existing components before creating new visual treatments.

## Color and themes

Colors live in [app/globals.css](app/globals.css). Two families work together:

- **Application tokens:** `background`, `foreground`, `card`, `popover`, `muted`, `border`, `input`, `ring`, `primary`, and `destructive`. Use their Tailwind classes for content, forms, and interactive states.
- **World tokens:** `--w-*` properties for terrain, bronze framing, parchment, roads, and soil. Use these variables for map chrome and artwork that should adapt to the theme.

Representative world values, expressed as `oklch(L C H)`:

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
| Pixelify Sans | `.pixel` | Map labels, HUD navigation, panel headings, short badges |

The `.pixel` class also sets `image-rendering: pixelated` and `shape-rendering: crispEdges`. Apply it selectively; long-form content should retain the normal text face.

Existing sizes establish this hierarchy:

- Eyebrows: 11–12px, uppercase, wide tracking, muted color.
- Map nameplates: 12px with 16px line height; small level badges use 12px bold.
- Supporting text and metadata: 11–12px; ordinary explanatory copy: 14px.
- HUD names and navigation: 14–16px; town panel titles: 18px with tight leading.
- First-project heading: 24px; undiscovered-section heading: 30px.

Use `tabular-nums` for counts and comparable numeric values. Truncate names and paths where the existing compact layouts require it.

## Surfaces and controls

### Bronze frame

[CivPanel](components/world/civ-panel.tsx) is the shared frame for HUD groups, legends, hover cards, empty states, and town panels.

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

Use [Button](components/ui/button.tsx) for ordinary form actions. It already supplies variants, sizing, disabled styling, and focus states. Its default height is 32px; regular UI controls retain their existing rounded corners. The bronze frame does not require every inner control to become square.

[PixelIcon](components/world/pixel-icon.tsx) supplies castle, scroll, and hourglass artwork for section navigation. Lucide icons handle functional controls such as zoom, back, information, and close. The command-menu orb is a deliberate circular exception: 56px across, with bronze rings, a sea-colored inset, and the dotted Thunk mark.

## Homepage composition

The [world layout](app/(world)/layout.tsx) fills `h-dvh`, clips overflow, and places the map under a shared HUD. The homepage has no project sidebar.

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

## Town styling

[TownView](components/town/town-view.tsx) reuses the homepage terrain, viewport, framed cards, and label treatment. Town centers represent workspaces; fields represent sessions and their spend-based crop stage. The library opens the project's notebook; the workshop opens the project's routines (standing orders) and shows the amber `!` when a routine run waits on approval.

Town navigation replaces the homepage title with a “World” back link and project name. Selecting an object opens a panel through a query parameter, retaining the surrounding map context and camera position.

[TownPanel](components/town/town-panel.tsx) defines the shared detail surface:

- Top offset: 80px. Right inset: 16px.
- Default width: `min(460px, calc(100vw - 2rem))`.
- `wide` width: `min(720px, calc(100vw - 2rem))`.
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

## Map artwork and states

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

## Checks when extending the design

- Reuse `CivPanel`, `TownPanel`, `IsoViewport`, `TerrainLayer`, `PixelIcon`, and existing UI primitives where their roles match.
- Verify both light and dark themes, including portalled surfaces.
- Check keyboard focus, Escape behavior, reduced motion, and map click-versus-drag behavior when touched.
- Check long names, empty states, small viewports, and content overflow.
- Keep unavailable features explicitly labeled and use current legends and status meanings.
- Read the relevant installed Next.js guide in `node_modules/next/dist/docs/` before changing application code, as required by `AGENTS.md`.
