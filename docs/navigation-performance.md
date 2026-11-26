# Navigation performance

Map and sidebar links prefetch their destination when hovered, focused, or touched. They do not fetch every visible dynamic route on mount. This applies to both Solar system and Game world maps, including canvas entries in the sidebar.

Workspace navigation renders the saved branch immediately and loads current branch/dirty-file decoration through `/api/workspaces/:id/git/status` after the workspace mounts. Slow Git commands therefore do not hold the route response open. The request is cancelled on workspace changes.

Sidebar action controls reserve their space while hidden so revealing them does not move the click target. Session stream callbacks ignore updates belonging to the previous session.

Measure navigation in a production build with representative data: reload the project, click its workspace, and wait for the chat heading and composer. Record route-request counts as well as elapsed time, and use the same completion condition before and after. Development compilation and server deployments distort timings.
