"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildRevisionPayload } from "@/lib/revisions/build-payload";
import { collectRevision } from "@/lib/revisions/collect";
import type { DocState } from "@/lib/store/session-store";
import { DiffView } from "./diff-view";

/** Preview exactly what will be sent: the redline and the literal XML payload. */
export function RevisionDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: DocState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const snapshot = useMemo(() => (open ? collectRevision(doc) : null), [open, doc]);
  const payload = useMemo(
    () =>
      snapshot
        ? buildRevisionPayload({
            documentId: doc.id,
            version: doc.version,
            kind: doc.kind,
            ...snapshot,
          }).payload
        : "",
    [snapshot, doc.id, doc.version, doc.kind],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review revisions</DialogTitle>
          <DialogDescription>
            Your edits against the original, and the message Claude will receive.
          </DialogDescription>
        </DialogHeader>
        {snapshot && (
          <Tabs defaultValue="changes" className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="payload">Payload</TabsTrigger>
            </TabsList>
            <TabsContent value="changes" className="min-h-0 overflow-y-auto rounded-md border p-4">
              <DiffView before={snapshot.baselineMarkdown} after={snapshot.editedMarkdown} />
            </TabsContent>
            <TabsContent value="payload" className="min-h-0 overflow-y-auto rounded-md border p-4">
              <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{payload}</pre>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
