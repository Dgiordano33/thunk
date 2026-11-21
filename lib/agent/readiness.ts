export type AgentReadiness = { state: "ready" | "missing" | "signed-out" | "unavailable"; message: string; command?: string };
export type AgentStatuses = Record<"claude" | "codex", AgentReadiness>;
export function checkResult(provider: "claude" | "codex", result: { missing?: boolean; signedIn?: boolean; error?: boolean }): AgentReadiness {
  if (result.missing) return { state: "missing", message: "Not installed", command: provider === "claude" ? "npm install -g @anthropic-ai/claude-code" : "npm install -g @openai/codex" };
  if (result.signedIn === false) return { state: "signed-out", message: "Sign in to start sessions", command: provider === "claude" ? "claude auth login" : "codex login" };
  if (result.error) return { state: "unavailable", message: "Could not check this agent. Check again or inspect its installation." };
  return { state: "ready", message: result.signedIn ? "Signed in" : "Installed · sign-in not verified" };
}
