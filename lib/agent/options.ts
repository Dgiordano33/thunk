import "server-only";
import type { Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { buildCanUseTool } from "./permissions";
import type { LiveSession } from "./session-registry";

const CANVAS_PROMPT = `
# Thunk canvas
You are running inside Thunk, a harness where your final prose in each turn is shown to the user as an editable document (a "canvas"), not a chat bubble. Write that final prose as a clean, well-structured markdown document. Avoid filler like "Let me know if...".

The user may edit the document directly and leave comments on highlighted spans, then send them back as a <document_revision> message containing a unified diff of their edits, the quoted comment threads, and the full edited document. When you receive one:
- Treat their edits as authoritative and keep them unless a comment asks otherwise.
- Address every comment. Answer questions inline where natural.
- Reply with the complete revised document in markdown (not a diff), keeping anything they did not touch. Do any tool work first; the revised document must be your final prose for the turn.
- End with a short "Notes" section only if you need to explain something that doesn't belong in the document.
`.trim();

export function buildOptions(live: LiveSession, { resume }: { resume?: string }): Options {
  return {
    cwd: live.meta.cwd,
    model: live.meta.model,
    permissionMode: live.meta.permissionMode as PermissionMode,
    // Lets the user switch to bypassPermissions from the mode picker later.
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    // Load the workspace's CLAUDE.md + .claude/settings(.local).json like Claude Code does in a repo,
    // but not ~/.claude (global plugins/hooks). Our permissionMode still wins over defaultMode.
    settingSources: ["project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code", append: CANVAS_PROMPT },
    // `env` replaces process.env entirely, so always spread it.
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "thunk/0.1.0" },
    resume,
    canUseTool: buildCanUseTool(live),
    stderr: (data) => {
      live.stderrTail.push(data);
      if (live.stderrTail.length > 50) live.stderrTail.shift();
    },
  };
}
