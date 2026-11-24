# Capture

Enter a thought in the Inbox or open Capture with Command/Ctrl+Shift+K. Captures route asynchronously and dispatch directly to a worker. Research defaults to a read-only scout; explicit changes can use an isolated worktree. Project tags pin routing. Unmatched thoughts run in Home.

The router tries twice with a 45-second deadline per attempt. Failed thoughts offer Retry. Thoughts under way are listed under the Inbox capture field. A ready thought appears in Decisions, in time order with the rest, with the worker session and review result. Ready thoughts can continue, receive a redirect, be kept, or discarded. A redirect with another project's tag archives the previous isolated workspace and routes a fresh worker. The original thought remains in the capture text. You can save the redirect as a Home routing rule.

Discard cancels work and archives isolated workspaces; it never archives the shared scout workspace. Undo restores the record and workspace, but does not automatically restart cancelled work. Archived worktrees retain their files under the existing housekeeping policy.

The limit defaults to eight open captures. Set `maxOpen` in `~/.thunk/config/capture.json` (or under `THUNK_DATA_DIR`). Kept and discarded records no longer count. Capture-ready notifications appear in Needs you delivery settings and are the ready thought's row in the Inbox; they close through Keep, Discard, Go ahead or Redirect rather than dismiss.

The Electron shortcut defaults to Alt+Space and is disabled if unavailable. Change or disable it in Settings → Appearance. It is stored on this computer, including when connected to a remote backend. Submission, Escape and blur hide the capture window. Mobile has a Capture navigation button. Browser drafts survive dismissing the bar within the tab.

First-crack restrictions are worker instructions: no pushing, PRs, merging, deploying or sending before approval. Existing worker tool permission handling still applies. Go ahead authorizes the displayed next step only.
