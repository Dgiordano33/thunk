import "server-only";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deleteSession as sdkDeleteSession } from "@anthropic-ai/claude-agent-sdk";
import { providerOf, type SessionMeta } from "./types";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");

/** Where the Claude Code subprocess writes a session's transcript: ~/.claude/projects/<cwd slug>/<id>.jsonl. */
function transcriptPath(cwd: string, sdkSessionId: string) {
  return path.join(CLAUDE_DIR, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sdkSessionId}.jsonl`);
}

/**
 * Delete the SDK transcript behind a Thunk session. Transcripts with turns from
 * any other entrypoint (a terminal session continued in Thunk) are left alone:
 * the user still owns that history outside Thunk.
 */
export async function deleteTranscript(session: Pick<SessionMeta, "sdkSessionId" | "cwd" | "model">) {
  const { sdkSessionId, cwd } = session;
  if (!sdkSessionId || providerOf(session.model) !== "claude") return;
  const text = await readFile(transcriptPath(cwd, sdkSessionId), "utf8").catch(() => null);
  if (text === null || /"entrypoint":"(?!sdk-)/.test(text)) return;
  await sdkDeleteSession(sdkSessionId, { dir: cwd }).catch((err) =>
    console.error("[thunk] delete transcript failed", sdkSessionId, err),
  );
}

export async function deleteTranscripts(sessions: Pick<SessionMeta, "sdkSessionId" | "cwd" | "model">[]) {
  await Promise.all(sessions.map(deleteTranscript));
}
