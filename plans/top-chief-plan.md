# A top chief above projects: notes routed across projects

Status: implemented · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-17

## Goal

You write in a note that belongs to no project. An agent reads it and sends each item to the project, or the workspace, that should do it. Project chiefs keep doing what they do now; the top chief only routes, and hears back when routed work settles.

## Decisions

- **The Home project is glue, not a place.** It is an ordinary repo-less project with the reserved data key `__home`, so notes, memory, sessions and the inbox all work unchanged. `listProjects()` leaves it out unless asked (`includeHome`), so it has no planet, city, sidebar row or picker entry. It surfaces only as the Library's **Top level** notebook.
- **The top chief routes; it never starts workers.** It is a session in Home's `main` with `origin.kind = "top_chief"`. Claude top chiefs have Edit, Write, NotebookEdit and Bash disallowed. Its tools are `projects_list`, `note_items`, `route_plan`, `routes_status`, `routing_rule` and `top_log`.
- **Approval before dispatch, always.** `route_plan` produces an inbox card (reusing the `delegation_plan` kind, so no migration). Approving pushes a `<routed_request>` to each target project's chief. Rejecting tells the top chief, which asks the person.
- **Routing tags make routing deterministic.** `#project`, `#project/workspace` and `## Project` headings pin items, parsed in `lib/home/routing.ts`. A pinned item routed elsewhere is refused by `route_plan`, not just discouraged by the prompt. Ambiguous items become an `AskUserQuestion`, and the answer is saved with `routing_rule` to Home memory ("Routing memory").
- **The note is the ledger.** Routed lines get `→ <Project>: <status> (r:<ref>)`. The ref keeps them from being routed twice and lets the status be updated after the line moves. `done` ticks the box.
- **Roll-up by an explicit report.** The project chief calls `route_report` once per routed request. That updates the route, the note line and the top-level work log, and pushes a `<route_report>` to the top chief. This costs one tool call instead of inferring completion from task state.
- **Triage is a built-in schedule, not a routine.** Routines create worktrees and their own sessions. Triage only needs to push one message to the top chief: a 60-second ticker reads `config/routing/triage.json` in Home. It is off by default, defaults to weekdays at 08:30 in the browser's time zone, and skips the model turn when no item is unrouted and nothing has settled.

## Not done yet

- A global worker cap across projects (each project still allows four).
- Cross-project dependencies ("B in project Y after A in project X").
- Skipping a tier for small items (straight to a worker without the project chief).
- Routing on note save instead of on Route or triage.

## Files

`lib/home/` (constants, routing parser and tests, service, tools, prompt, triage), `app/api/chief/routes/[planId]`, `app/api/chief/triage`, the Top level notebook and `TriageSettings` in `components/notes/`, `route_report` and the `<routed_request>` prompt rule in `lib/workers/prompt.ts`, and `tests/top-chief.test.cjs`.
