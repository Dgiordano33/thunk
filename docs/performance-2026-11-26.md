# Performance measurements — November 26, 2026

Long-chat opening was dominated by client work: replay copied growing maps for individual events, then the page initialized every document's TipTap editor, including offscreen history. The changes copy collections once per unpublished batch and defer offscreen editors. History, SQL persistence, SSE transport, navigation prefetch behavior, and process lifetimes are preserved. No indexes, database pool changes, cache, or dependencies were added.

## Conditions

- Baseline: `6889621` on the existing workspace branch. Both versions used Next.js 16.2.4 production builds with `--webpack`; Turbopack rejected the workspace's dependency symlink outside its filesystem root. Builds were under `.context/perf/build-before` and `build-after`, served with `next start` on loopback port 4619. This exercises the production application, not the standalone packaging path (`next start` logs a standalone-output warning).
- Apple M3 Pro, 11 logical CPUs, 18 GiB RAM, macOS 27.2, Node 24.18.1; Playwright Chromium 159.0.8154.6, headless, 1440×960. Electron comparison used 45.2.3 / Chromium 156.0.8078.80 in a visible, isolated BrowserWindow with the desktop shell's dimensions and sandbox settings.
- The workspace resolves to embedded PGlite by default. No DATABASE_URL or database-copy source was configured. Benchmarks forced embedded mode and used a dedicated THUNK_DATA_DIR. No live database, connected Supabase project, or production files were queried.
- Synthetic persisted fixture: 12 projects, 96 workspaces, 2,400 session metadata rows, 9,090 events, 303 documents, 240 notes, 600 tasks, 120 ready Vault items, and 20 canvas cards per project. Histories are concentrated in two sessions: 300 turns / 9,000 events / 900 tool calls / 300 documents, and a three-turn comparison chat. Other sessions stress navigation-list cardinality. This is not a large, evenly distributed message archive.
- All folders are synthetic, with no repository remotes, enabled routines, worker queue, captures, integration configuration, or pending Vault extraction. Background schedulers remained enabled. The database was initialized through normal application startup. The same pristine fixture was restored before each comparison phase.
- Completion: the requested chat heading is visible and the composer can accept and clear text. Workspace navigation waits for the heading and composer. The dense map's workspace link is activated with Enter because an overlapping satellite intercepts pointer clicks in this fixture. Project clicks include Playwright's wait for a stable target during the map entrance.
- Eight warm browser samples per interaction, five warm Electron samples, and 30 store/query samples after three warmups. Medians below use the average of the two central values for even sample counts. Cold route visits and ten-second idle observations are single diagnostics, not percentile estimates. “Cold” means a fresh browser/first route visit, not a flushed OS disk cache. Browser before/after phases ran serially after both builds finished.

## Before and after

| Measurement | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Long chat, warm browser navigation, n=8 | 1,247 ms (1,222–1,395) | 493 ms (478–515) | 60.5% |
| Workspace → long chat, n=8 | 1,112 ms (1,050–1,232) | 398.5 ms (381–455) | 64.2% |
| Long chat in Electron, warm, n=5 | 1,467 ms (1,443–1,621) | 619 ms (600–641) | 57.8% |
| 9,000-event store hydration, n=30 | 88.26 ms | 1.25 ms | 98.6% |
| 120 streaming deltas plus turn start, n=30 | 1.408 ms | 0.179 ms | 87.3% |
| Browser long-chat long-task time, median per load | 833.5 ms | 157.5 ms | 81.1% |
| Editors mounted after long-chat opening | 300 | 5–6 | 98% |
| Three-turn chat, warm, n=8 | 247.5 ms (227–260) | 249 ms (242–261) | Essentially unchanged |
| Projects → project, n=8 | 488 ms (353–592) | 470.5 ms (351–649) | Within observed variability |

Warm chat measurements navigate a document URL with the browser cache warm; they are not repeated router-cache hits. The workspace measurement uses client navigation. Full history still transfers: median total response-body bytes for a warm long-chat load were 337,950 before and 337,948 after. Workspace navigation still makes two route requests in the median run (intent prefetch and navigation); one baseline run made three. The optimization does not claim a network or history-payload reduction.

The long-chat load window, through 100 ms after readiness, recorded a median 71 completed SQL calls in both versions (range 71–74, including layout, background, and follow-up requests). Removing those repeated reads may matter much more with a remote database; it was not part of the measured client improvement.

Single cold observations: API readiness from server spawn was 860 → 871 ms; first usable projects screen from server spawn, including browser launch, was 1,935 → 1,604 ms; first projects route was 532 → 464 ms; first long-chat route was 1,554 → 780 ms. These are startup diagnostics, not repeatable startup improvement claims.

Single section smoke measurements were Notes 184 → 167 ms, Tasks 449 → 422 ms, Inbox 84 → 102 ms, Vault 105 → 101 ms, and Canvas 261 → 274 ms. Completion used fixture text/cards or the Inbox label. Inbox was empty. These sections were not optimized and the samples do not establish performance differences.

## Database and runtime findings

On the isolated PGlite fixture, 30 warm direct query samples gave medians of 4.2 ms for all project summaries, 2.3 ms for all workspace summaries, 25.3 ms for the long chat's 9,000 events, and 2.3 ms for its 300 documents. EXPLAIN ANALYZE plans are retained. The workspace count uses the existing sessions workspace index. The message query scans most of this fixture's messages because nearly all belong to the requested session. That plan is not evidence for adding another index. The project aggregate does repeatedly scan sessions and merits reconsideration with a larger, distributed archive.

The production query probe records SQL, duration including queue/startup waiting, returned-row counts, and concurrent outstanding queries. Several startup queries wait on PGlite initialization; their elapsed time is not SQL execution time. No external Postgres pool waiting, network latency, or database lock contention was measured.

During a ten-second idle map observation, the Node server's median CPU was 0.27% before / 0.29% after, RSS about 292 / 294 MiB, and heap about 85.6 MiB in both. There were no active child-process handles in those samples. With three idle tabs, median CPU was 0.15% in both; RSS varied with GC and was 259 / 299 MiB. These short observations do not establish memory-leak behavior. Idle event-loop maximum delays were 23 / 38 ms for one tab and 66 / 61 ms for three.

The solar-system canvas was active. Chromium's renderer accumulated about 2.98 / 2.94 seconds of TaskDuration during the ten-second map observation, while ScriptDuration was about 32 ms. Ambient rendering remains a meaningful cost. Electron's visible-window samples likewise showed continued renderer/GPU work. Calling `hide()` in the test harness did not change `document.hidden`, so that experiment does not verify background throttling. Electron process memory samples varied substantially after navigation and GC; no memory reduction is claimed.

## Validation

- `npm run typecheck` passed.
- Session batching, document viewport, navigation performance, database, and agent-session suites passed (30 tests). Coverage includes frozen prior snapshots, mixed event types and batch boundaries, unchanged-entry identity, persisted edits/comments and linkage, stale/foreign events, deferred editor lifetime, and missing IntersectionObserver support.
- `npm run test:lib` passed (124 tests).
- Production builds passed. Lint on every changed source/test file passed. Full `npm run lint` reports the existing `@typescript-eslint/no-this-alias` error in `desktop/connections.test.cjs:36` and two existing warnings in notes/desktop code; those files are unchanged.
- Production browser validation confirmed that opening older history mounts its editor, scrolling away and back retains the same editor instance, edits survive reload, document deep links work, and the Game world look still supports editing.
- Three synthetic agent streams each emitted 300 tokens through the production subscription and persistence hooks. A visible session recovered from an offline interval, switching sessions rejected foreign text, all 900 tokens appeared exactly once in persisted replay, and a final reload restored the response. No Claude/Codex model turns were started. This validates the app transport/reducer path, not provider performance.

## Remaining work, ranked

This was the ranking after the long-chat changes. The subsequent [multi-tab, prefetch, and idle-rendering follow-up](performance-2026-11-26-followup.md) addresses the first three items and records their remaining limits.

1. **Share or multiplex passive SSE feeds across tabs.** Each tab opens notifications, tasks, and notes EventSources before any session stream. Three tabs reproduced a five-second reload timeout on the unchanged baseline; closing the other tabs let navigation finish in 307 ms. Concurrent synthetic agents persisted correctly, but all three tabs did not acquire their session streams. Browser connection-slot pressure is the likely cause. Transport changes need separate reconnect, leader-lifetime, and per-session replay coverage.
2. **Remove remaining settings-page speculative work.** The project-navigation trace includes settings-route prefetches for all 12 projects, producing 21–26 route requests during the measured interaction. Inspect `ProjectDetailsLink` and its map/mobile callers. This work was outside the two implemented changes; existing intent-based links remain intact.
3. **Reduce solar-system idle rendering and entrance cost.** The measured map remains busy even with no agent activity. Profile GPU/compositor work on the actual packaged app before changing its visual cadence; verify native hide/occlusion behavior explicitly.
4. **Reduce long-history transfer/rendering with a correct history model.** The full history still transfers and about 158 ms of long-task work remains. Any pagination or snapshot design must retain approvals, document revisions, tool relationships, and SSE replay boundaries. Mounted editors deliberately remain alive, so visiting every document eventually recreates their memory cost.
5. **Measure a larger database and real provider/runtime workloads.** External Postgres, a large distributed message archive, real Git repositories, provider subprocess CPU/persistence under model output, and the packaged Electron startup/update/preload path were not benchmarked. The Electron test measured the renderer and process overhead in an isolated matching window, not the full installed app lifecycle.

## Local evidence

The workspace's gitignored `.context/perf/` contains `seed.cjs`, `fixture.json`, the pristine data copy, both production builds and build logs, `bench.cjs`, per-phase `browser.json` and SQL/runtime `probe.jsonl`, `store-bench.cjs`, a Node CPU profile, `sql-bench.cjs` and EXPLAIN ANALYZE output in `sql.json`, `electron-bench.cjs` and `electron.json`, `validate.cjs` and validation results/screenshots, and `connections.cjs` with the baseline multi-tab reproduction. Final comparison data is under `before/` and `after/`; `pilot-*` and `exploratory-*` are discarded setup runs.

To rerun, stop any benchmark server, restore `.context/perf/data` from `.context/perf/pristine`, then run `node .context/perf/bench.cjs before`. Stop it and restore the same pristine copy before `node .context/perf/bench.cjs after`. The scripts use only loopback and dedicated fixture directories; never substitute the live data directory. Store/query scripts are independent. Baseline source must be built from the stated commit if the retained build is removed.

The investigation and benchmarks did not deploy, restart the live app, rename the branch, push, merge, or apply migrations manually.
