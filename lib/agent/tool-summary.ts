// Shared between server and client. Keep free of server-only imports.

/** One-line human summary of a tool call's input. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  const short = (p: string) => p.split("/").slice(-3).join("/");
  switch (name) {
    case "Bash":
      return str("description") || str("command");
    case "ApplyPatch": {
      // Codex file edits: one patch can touch several files.
      const paths = Array.isArray(i.changes) ? (i.changes as { path?: string }[]).map((c) => short(c.path ?? "")) : [];
      return paths.length > 2 ? `${paths.slice(0, 2).join(", ")} +${paths.length - 2}` : paths.join(", ");
    }
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return short(str("file_path") || str("notebook_path"));
    case "Grep":
      return `${str("pattern")}${str("path") ? ` in ${short(str("path"))}` : ""}`;
    case "Glob":
      return str("pattern");
    case "WebFetch":
      return str("url");
    case "WebSearch":
      return str("query");
    case "Task":
    case "Agent":
      return str("description");
    case "TodoWrite":
      return "Update todos";
    default:
      return "";
  }
}
