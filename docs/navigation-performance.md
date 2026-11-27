# Navigation performance

Map and sidebar links prefetch their destination when hovered, focused, or touched. They do not fetch every visible dynamic route on mount. This applies to both Solar system and Game world maps, including canvas entries in the sidebar.

Project details links (including mobile project lists) and the Settings section rail/index use the same intent-based prefetching. Opening a map no longer speculatively loads every project's settings.

The Solar system map links directly to a workspace’s latest known session (or new chat for an empty workspace), avoiding a redirect round trip. When the bounded project session list does not contain its sessions, it uses the workspace resolver.

Workspace navigation renders the saved branch immediately and loads current branch/dirty-file decoration through `/api/workspaces/:id/git/status` after the workspace mounts. Slow Git commands therefore do not hold the route response open. The request is cancelled on workspace changes.

Sidebar action controls reserve their space while hidden so revealing them does not move the click target. Session stream callbacks ignore updates belonging to the previous session.

Long chats keep their full history. Event replay copies each changed collection once per batch, while preserving published snapshots, edited documents, and event ordering. Hydration and streaming both reject foreign-session and stale events.

Notes, tasks, Inbox, and captures share a passive `/api/events` stream through a same-origin SharedWorker. Closing the first tab does not interrupt other tabs; the last subscriber releases the connection. Browsers that cannot start the worker use one multiplexed connection per tab. These feeds refresh snapshots on reconnect, page-cache restoration, and return online; open notes retain their existing unsaved-edit conflict checks. Session replay, canvas streams, and terminal streams remain independent. Many simultaneous live sessions can still exhaust HTTP/1.1 connection slots, especially with the per-tab fallback.

Solar-system maps retain ambient animation at about 30fps and full-rate interaction. The renderer sleeps between ambient frames and reuses body ordering until scene data changes. Reduced motion stops rendering after its 150ms entrance fade and redraws on changes. Removing a hovered body clears its animation state. Hiding a document cancels both frame and timer work; Electron minimization/occlusion must actually report the document hidden for this pause to apply.

The active document opens its editor immediately. Older documents keep their text in the page and initialize editors within 600px of the conversation viewport, or on focus/pointer interaction. Once initialized, an editor stays mounted until its document leaves the timeline, preserving selection and undo state. Scrolling through all of history can therefore still grow memory use. Browsers without IntersectionObserver initialize all editors.

Measure navigation in a production build with representative data: reload the project, click its workspace, and wait for the chat heading and composer. Record route-request counts as well as elapsed time, and use the same completion condition before and after. Development compilation and server deployments distort timings.

See [the November 26 performance measurements](performance-2026-11-26.md) for the isolated production comparison, validation, and remaining bottlenecks.
The [multi-tab, prefetch, and idle-rendering follow-up](performance-2026-11-26-followup.md) records the subsequent transport and rendering measurements.
