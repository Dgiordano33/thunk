"use client";

import { ThreadList } from "@/components/comments/thread-list";
import { MODE_LABELS, modelLabel } from "@/components/session/labels";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/store/session-store";

export function RightPanel() {
  const doc = useSession((s) => (s.activeDocumentId ? s.documents[s.activeDocumentId] : undefined));
  const openCount = doc?.comments.filter((c) => c.status === "open").length ?? 0;

  return (
    <Tabs defaultValue="comments" className="flex h-full flex-col gap-0">
      <div className="border-b px-3 py-2">
        <TabsList className="w-full">
          <TabsTrigger value="comments">
            Comments
            {openCount > 0 && <span className="text-muted-foreground ml-1 text-xs">{openCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="session">Session</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="comments" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="p-3">
            {doc && (
              <p className="text-muted-foreground mb-3 text-xs">
                {doc.kind === "plan" ? "Plan" : "Response"} v{doc.version}
                {doc.status !== "draft" && " · read-only"}
              </p>
            )}
            <ThreadList />
          </div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="session" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <SessionInfo />
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

function SessionInfo() {
  const meta = useSession((s) => s.meta);
  const costUsd = useSession((s) => s.costUsd);
  const numTurns = useSession((s) => s.numTurns);
  const connection = useSession((s) => s.connection);
  const docCount = useSession((s) => Object.keys(s.documents).length);
  if (!meta) return null;

  const rows: [string, string][] = [
    ["Directory", meta.cwd],
    ["Model", modelLabel(meta.model)],
    ["Mode", MODE_LABELS[meta.permissionMode] ?? meta.permissionMode],
    ["Status", meta.live ? meta.status : "not live"],
    ["Connection", connection],
    ["Cost", `$${costUsd.toFixed(4)}`],
    ["API turns", String(numTurns)],
    ["Documents", String(docCount)],
    ["SDK session", meta.sdkSessionId ?? "—"],
    ["Thunk session", meta.id],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
