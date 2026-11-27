# Multi-tab connections, prefetching, and idle rendering

This follows the [long-chat performance work](performance-2026-11-26.md). The baseline is `f2921b4`, including the long-chat changes and the merge from main. Work stayed on the existing workspace branch; no live database, deployment, provider turn, or live application restart was involved.

## Changes

**Passive events:** notes, tasks, notifications, and captures now travel over `/api/events`. A same-origin SharedWorker owns one EventSource and forwards ordered messages to subscribed tabs. The first tab has no special ownership role. Each tab releases its port on page hide or its last unsubscribe; restoration reconnects it. The final port closes the source. If the worker is unavailable, blocked, or fails to load, each tab falls back to one multiplexed EventSource. Legacy individual endpoints remain available.

Passive events are invalidations, not a replay log. New subscribers and reconnecting tabs refresh snapshots. Notes invalidate every scope and open editor on reconnect, using the existing unsaved-edit conflict handling. Returning online retries snapshot requests even if the worker stayed connected. Inbox initial and connection-open reads are coalesced, and initial loading does not depend on the stream opening. Session streams keep their existing sequence numbers, reconnect/replay, reducer, and persistence behavior. Canvas and terminal streams remain separate.

**Settings prefetches:** `ProjectDetailsLink` and the desktop/mobile settings navigation now use the existing `IntentLink`. Hover, focus, and touch still prefetch; merely displaying project details controls no longer fetches every project's settings route.

**Map scheduling:** the renderer sleeps until the next ambient frame instead of polling every display refresh. It keeps a 30fps deadline cadence, accounting for timer/vsync lateness without accumulating it or replaying frames after a long pause. Interaction and entrance animation remain full rate. Body sorting is reused until scene data changes, and removed bodies no longer leave stale hover state keeping the loop busy. Reduced motion ends its entrance after 150ms and redraws on changes. Visibility changes and disposal cancel both pending frames and timers.

## Measurement conditions

The same synthetic persisted fixture from the first report was restored for each phase: 12 projects, 96 workspaces, 2,400 sessions, 9,090 events, 303 documents, 240 notes, 600 tasks, and 120 Vault items. These runs used embedded PGlite, dedicated `.context/perf/` data/build directories, Next.js 16.2.4 production webpack builds, and loopback ports 4621–4623. Builds and other tests finished before measurements. The instrumented production server uses `next start`, not the standalone packaged entry point.

The machine remains an M3 Pro running Node 24.18.1. Headless Chromium used a 1440×960 viewport at DPR 1 and reported **SwiftShader software rendering**. The separate Electron 45.2.3 window reported **Apple M3 Pro Metal rendering**, DPR 2, and approximately 120Hz animation callbacks on the baseline. It uses the desktop shell's window/sandbox settings but does not exercise the packaged startup, preload, updater, or connection setup.

There are eight project-navigation samples per browser phase and three consecutive five-second idle windows per browser/Electron phase. Route counts include the projects page and navigation to the project, with 700ms settling windows to capture speculative work. Reload tests use three tabs on the short chat and require its heading to be visible, with a five-second timeout. These short sequential observations do not establish percentile latency, battery savings, memory leaks, or a general CPU improvement.

## Before and after

| Measurement | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Passive SSE demand across three tabs | 9 streams | 1 shared stream | 88.9% fewer required connections; baseline requests exceed HTTP/1.1 slots |
| Three-tab chat reload, one diagnostic | Timed out at 5,002ms | 224ms | Connection starvation reproduction resolves |
| Route requests per projects → project sample, n=8 | 26 | 2 | 92.3% fewer requests in every sample |
| Of those, project-settings requests | 24 | 0 | No speculative settings work without intent |
| Headless idle callbacks per five seconds, median of 3 | 300 | 150 | 50% fewer callbacks |
| Headless rendered map frames per five seconds | 150 | 150 | Ambient cadence preserved |
| Headless renderer TaskDuration per five seconds, median | 1,378ms | 1,370ms | Essentially unchanged |
| Electron idle callbacks per five seconds, median of 3 | 601 | 150 | About 75% fewer callbacks on the 120Hz display |
| Electron rendered map frames per five seconds | 150 | 150 | Ambient cadence preserved |
| Electron renderer TaskDuration per five seconds, median | 377ms | 336ms | 11% lower in these short observations |

The map fixture draws 15 WebGL primitives per rendered frame. Browser frame counts are derived from 2,250 `drawArrays` calls per five-second window; callbacks are counted separately. The additional timer callbacks are inexpensive but do mean halving animation callbacks is not equivalent to halving CPU wakeups or CPU time.

Electron TaskDuration ranged from 377–407ms before and 290–337ms after. This is renderer task time, not total application/GPU CPU or battery use. Both versions stopped drawing under reduced motion after settling. Native minimize did not set `document.hidden` in either harness run, so ambient frames continued; native background suspension remains unverified.

Project-click latency did **not** improve: the median was 357.5ms (318–530) before and 422.5ms (305–497) after. These samples include map entrance/click-target stabilization, vary substantially, and ran in separate phases. The supported prefetch result is removal of requests, not faster measured clicks. Reload is a single diagnostic with a censored baseline, not a latency percentile or precise speedup estimate.

## Validation

- Production browser validation observed one passive server connection for three tabs. Task creation reached all tabs; closing the original tab did not interrupt delivery. Reload and return-online recovery passed. Forcibly destroying the server's shared stream recovered missed task changes and refreshed open note editors. Closing all tabs released every passive subscription; server-owned background subscribers remained.
- Three concurrent synthetic agent sessions each had exactly one browser subscriber in addition to their existing server subscribers. All 300 tokens per session appeared exactly once in the UI and persisted replay after an offline interval. Switching sessions rejected foreign text, and reload restored the completed response. No model provider was invoked.
- With SharedWorker disabled, three tabs each used one multiplexed source and all received task updates. This fallback does not remove cross-tab HTTP/1.1 limits for larger numbers of live session/canvas/terminal streams.
- Unit coverage includes ordered worker fanout, late subscribers, closing the first/last tab, blocked/failed workers, page-cache restoration, online recovery, ignoring callbacks from closed transports, topic isolation, server abort/cancel cleanup, and notes snapshot invalidation. Renderer coverage includes 60/120/144Hz scheduling, delayed frame timestamps, immediate interaction, reduced motion, visibility/disposal cleanup, and removed hover targets.
- Typecheck and production builds passed. Targeted feature/server suites, client suites, renderer tests, and all 124 library tests passed. Changed-file lint passed.
- Full `npm test` encountered two existing failures in `tests/multi-repo.test.cjs`: its TypeScript loader resolves `@/lib/agent` to nonexistent `lib/agent.ts` instead of the directory entry. Both failures were reproduced in an isolated archive of unmodified `f2921b4`. Full lint reports the existing `desktop/connections.test.cjs:36` error and the existing notes/desktop warnings.

## Remaining work

1. **Packaged-app visibility and rendering cost.** The isolated Electron window still reported `document.hidden === false` when minimized, and continued rendering. Do not interpret this as verified native background throttling. The full packaged hide/occlusion/startup path and longer battery/CPU observations remain unmeasured. Reducing callback scheduling does not eliminate the GPU work of drawing animated maps.
2. **Many simultaneous active streams.** Shared passive events free connection slots, but session, canvas, and terminal streams can still exhaust HTTP/1.1 limits. Extending multiplexing to those streams requires their own replay and ownership model. Unsupported-worker browsers retain one passive connection per tab.
3. **Long-history transfer and database/provider workloads.** History still transfers in full, and visited document editors stay mounted. External Postgres, a larger distributed message archive, real Git repositories, and actual model subprocess workloads remain unmeasured. No pool size or indexes changed.

## Evidence and rerunning

Gitignored `.context/perf/` retains `followup.cjs`, `followup-probe.cjs`, `validate-feeds.cjs`, `followup-electron.cjs`, and `followup-electron-main.cjs`. Final measurements are in `followup-before/result.json`, `followup-after/result.json`, `followup-electron.json`, and `followup-validation/result.json`, with screenshots, traces, SQL probes, and build/check logs. `followup-intermediate*` files are discarded pacing experiments, not final comparisons. `baseline-multi-repo.log` records the unchanged-baseline test failures.

With the corresponding `build-followup-before` / `build-followup-after` production builds present, run `node .context/perf/followup.cjs before` and then `node .context/perf/followup.cjs after`. The scripts restore their own fixture directories from `.context/perf/pristine`. Run Electron measurements serially with `node .context/perf/followup-electron.cjs`; run functional transport checks with `node .context/perf/validate-feeds.cjs`. Keep these paths isolated from live data. Reusable regression tests live in `tests/app-events.test.cjs` and `tests/space-renderer.test.cjs`.
