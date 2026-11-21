import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "@/lib/env";
import { listCodexModels } from "./codex/models";
import { checkResult, type AgentStatuses } from "./readiness";
const exec = promisify(execFile);
async function check(provider: "claude" | "codex") {
  const binary = provider === "codex" ? env.CODEX_BIN ?? "codex" : "claude";
  try {
    await exec(binary, ["--version"], { timeout: 5000 });
  } catch (error) {
    return checkResult(provider, { missing: (error as NodeJS.ErrnoException).code === "ENOENT", error: true });
  }
  try {
    if (provider === "claude") {
      // This command reads credentials without starting an agent turn.
      const { stdout } = await exec(binary, ["auth", "status", "--json"], { timeout: 5000 });
      const status = JSON.parse(stdout);
      return checkResult(provider, { signedIn: typeof status.loggedIn === "boolean" ? status.loggedIn : undefined });
    }
    await exec(binary, ["login", "status"], { timeout: 5000 });
    await listCodexModels();
    return checkResult(provider, { signedIn: true });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    if (provider === "claude") {
      try {
        if (JSON.parse(err.stdout ?? "{}").loggedIn === false) return checkResult(provider, { signedIn: false });
      } catch { /* Older CLIs may not support auth status. */ }
      return checkResult(provider, {});
    }
    if (/not logged in|not signed in|authentication required/i.test(`${err.stdout} ${err.stderr}`)) return checkResult(provider, { signedIn: false });
    return checkResult(provider, { error: true });
  }
}
let cached: { at: number; result: Promise<AgentStatuses> } | undefined;
export function agentStatus(refresh = false) {
  if (!cached || refresh || Date.now() - cached.at > 30_000) {
    cached = { at: Date.now(), result: Promise.all([check("claude"), check("codex")]).then(([claude, codex]) => ({ claude, codex })) };
  }
  return cached.result;
}
