"use client";

import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { toolSummary } from "@/lib/agent/tool-summary";
import { useSession, type ToolCall } from "@/lib/store/session-store";

export { toolSummary };

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
        className="py-2 [&>div]:min-w-0 [&_svg]:shrink-0 [&_span]:max-w-[52ch] [&_span]:truncate [&_[data-slot=badge]]:shrink-0"
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
