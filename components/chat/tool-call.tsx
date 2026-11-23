"use client";

import { ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { toolSummary } from "@/lib/agent/tool-summary";
import { useSession, type ToolCall } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";
import { BanIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

export { toolSummary };

/** Leading status glyph: only running and failed calls get one; finished calls stay quiet. */
function StatusGlyph({ tool }: { tool: ToolCall }) {
  if (tool.approval === "deny") return <BanIcon className="size-3.5 text-orange-600" aria-label="Denied" />;
  if (tool.status === "error") return <XIcon className="size-3.5 text-destructive" aria-label="Error" />;
  if (tool.status === "running") return <Spinner className="size-3.5" />;
  return null;
}

/** One tool call as a single quiet line; click to see its input and output. */
export function ToolCallView({ toolUseId }: { toolUseId: string }) {
  const tool = useSession((s) => s.tools[toolUseId]);
  if (!tool) return null;
  const summary = toolSummary(tool.name, tool.input);
  return (
    <Collapsible className="group/tool not-prose min-w-0">
      <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-1.5 rounded-sm py-0.5 text-left text-muted-foreground text-xs hover:text-foreground">
        <ChevronRightIcon className="size-3 shrink-0 opacity-50 transition-transform group-data-[state=open]/tool:rotate-90" />
        <span className="shrink-0 font-medium">{tool.name}</span>
        {summary && <span className="min-w-0 truncate">{summary}</span>}
        <span className="ml-auto shrink-0 pl-2">
          <StatusGlyph tool={tool} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 mb-2 ml-4.5 space-y-3 rounded-md border bg-muted/30 p-3">
        <ToolInput input={tool.input} />
        <ToolOutput
          output={tool.status === "error" ? undefined : tool.output}
          errorText={tool.status === "error" ? tool.output : undefined}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

const VERBS: Record<string, [string, string]> = {
  Bash: ["Ran", "command"],
  Read: ["Read", "file"],
  Grep: ["Searched", "pattern"],
  Glob: ["Searched", "pattern"],
  Edit: ["Edited", "file"],
  Write: ["Wrote", "file"],
  ApplyPatch: ["Edited", "file"],
  NotebookEdit: ["Edited", "notebook"],
  WebFetch: ["Fetched", "page"],
  WebSearch: ["Searched", "query"],
  Task: ["Ran", "agent"],
  Agent: ["Ran", "agent"],
};

/** "Ran 8 commands, read 3 files" — a one-line digest of a run of tool calls. */
function groupLabel(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const [verb, noun] = VERBS[n] ?? ["Used", "tool"];
    const key = `${verb} ${noun}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, n], i) => {
      const [verb, noun] = key.split(" ");
      const v = i === 0 ? verb : verb.toLowerCase();
      return `${v} ${n} ${noun}${n === 1 ? "" : "s"}`;
    })
    .join(", ");
}

/**
 * A run of consecutive tool calls folded into one line. While the run is still
 * live, the latest call shows beneath it so progress stays visible.
 */
export function ToolGroup({ toolUseIds, live }: { toolUseIds: string[]; live: boolean }) {
  const tools = useSession(useShallow((s) => toolUseIds.map((id) => s.tools[id]).filter(Boolean)));
  if (toolUseIds.length === 1) return <ToolCallView toolUseId={toolUseIds[0]} />;

  const failed = tools.filter((t) => t.status === "error" || t.approval === "deny").length;
  const running = tools.some((t) => t.status === "running");
  const latest = toolUseIds[toolUseIds.length - 1];

  return (
    <Collapsible className="group/tools not-prose min-w-0">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-0.5 text-left text-muted-foreground text-xs hover:text-foreground">
        <ChevronRightIcon className="size-3 shrink-0 opacity-50 transition-transform group-data-[state=open]/tools:rotate-90" />
        <span className="truncate">{groupLabel(tools.map((t) => t.name))}</span>
        {failed > 0 && <span className="shrink-0 text-destructive">· {failed} failed</span>}
        {running && !live && <Spinner className="ml-auto size-3.5 shrink-0" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-1.5 border-l pl-3">
        {toolUseIds.map((id) => (
          <ToolCallView key={id} toolUseId={id} />
        ))}
      </CollapsibleContent>
      {live && (
        <div className={cn("ml-1.5 border-l pl-3 group-data-[state=open]/tools:hidden")}>
          <ToolCallView toolUseId={latest} />
        </div>
      )}
    </Collapsible>
  );
}
