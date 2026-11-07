"use client";

import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { useSession, type ToolCall } from "@/lib/store/session-store";

/** One-line human summary of a tool call's input. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  const short = (p: string) => p.split("/").slice(-3).join("/");
  switch (name) {
    case "Bash":
      return str("description") || str("command");
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

function toolState(t: ToolCall) {
  if (t.approval === "deny") return "output-denied" as const;
  if (t.status === "error") return "output-error" as const;
  if (t.status === "done") return "output-available" as const;
  return "input-available" as const;
}

export function ToolCallView({ toolUseId }: { toolUseId: string }) {
  const tool = useSession((s) => s.tools[toolUseId]);
  if (!tool) return null;
  const summary = toolSummary(tool.name, tool.input);
  return (
    <Tool className="mb-0 rounded-lg">
      <ToolHeader
        type="dynamic-tool"
        toolName={tool.name}
        state={toolState(tool)}
        title={summary ? `${tool.name} · ${summary}` : tool.name}
        className="py-2 [&_span]:max-w-[52ch] [&_span]:truncate"
      />
      <ToolContent>
        <ToolInput input={tool.input} />
        <ToolOutput
          output={tool.status === "error" ? undefined : tool.output}
          errorText={tool.status === "error" ? tool.output : undefined}
        />
      </ToolContent>
    </Tool>
  );
}
