"use client";

import { CheckIcon, ChevronDownIcon, FileTextIcon, ListChecksIcon, Loader2Icon, MessageSquareIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/client/api";
import { collectRevision } from "@/lib/revisions/collect";
import { useSession, type DocState } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";
import { DocumentEditor } from "./document-editor";
import { plural, RevisionBar, sendResponseRevision, useRevisionStat } from "./revision-bar";
import { RevisionDialog } from "./revision-dialog";

const STATUS_LABEL = { draft: "Draft", sent: "Revised", approved: "Approved" } as const;

/** A canvas page: one assistant response (or plan) the user can edit and comment on. */
export function DocumentCard({ documentId }: { documentId: string }) {
  const doc = useSession((s) => s.documents[documentId]);
  const active = useSession((s) => s.activeDocumentId === documentId);
  const request = useSession((s) => (doc?.requestId ? s.requests[doc.requestId] : undefined));
  const setActive = useSession((s) => s.setActiveDocument);
  const [expanded, setExpanded] = useState(false);

  const planPending = doc?.kind === "plan" && request?.status === "pending";
  const editable = Boolean(doc && doc.status === "draft" && (doc.kind === "response" || planPending));
  const collapsed = !editable && !expanded && doc?.status === "sent";

  const send = useCallback(async () => {
    const d = useSession.getState().documents[documentId];
    if (d?.kind === "response" && d.status === "draft") await sendResponseRevision(d);
  }, [documentId]);

  if (!doc) return null;
  const openComments = doc.comments.filter((c) => c.status === "open" && c.body.trim()).length;
  const Icon = doc.kind === "plan" ? ListChecksIcon : FileTextIcon;

  return (
    <article
      id={`doc-${documentId}`}
      onFocusCapture={() => setActive(documentId)}
      onMouseDown={() => !active && setActive(documentId)}
      className={cn(
        "bg-card relative scroll-mt-4 rounded-xl border px-8 pt-5 pb-4 shadow-xs transition-[border-color,box-shadow]",
        active && editable && "border-foreground/20 shadow-sm",
        !editable && "bg-muted/20",
      )}
    >
      <header className="text-muted-foreground mb-4 flex items-center gap-2 text-xs">
        <Icon className="size-3.5" />
        <span className="font-medium">{doc.kind === "plan" ? "Plan" : "Response"}</span>
        {doc.version > 1 && <span>v{doc.version}</span>}
        <Badge variant={doc.status === "draft" ? "outline" : "secondary"} className="h-4.5 px-1.5 text-[10px]">
          {STATUS_LABEL[doc.status]}
        </Badge>
        {openComments > 0 && (
          <span className="flex items-center gap-1">
            <MessageSquareIcon className="size-3" />
            {openComments}
          </span>
        )}
        {doc.status === "sent" && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? "Collapse" : "Expand"}
            <ChevronDownIcon className={cn("transition-transform", expanded && "rotate-180")} />
          </Button>
        )}
      </header>

      <div className={cn(collapsed && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_50%,transparent)]")}>
        <DocumentEditor documentId={documentId} editable={editable} onSubmitShortcut={editable ? send : undefined} />
      </div>

      {editable && doc.kind === "response" && (
        <footer className="mt-5">
          <RevisionBar doc={doc} onSend={send} />
        </footer>
      )}
      {doc.kind === "plan" && request?.kind === "plan" && (
        <footer className="mt-5">
          <PlanActions doc={doc} requestId={request.id} status={request.status} decision={request.decision} />
        </footer>
      )}
    </article>
  );
}

function PlanActions({
  doc,
  requestId,
  status,
  decision,
}: {
  doc: DocState;
  requestId: string;
  status: "pending" | "resolved" | "expired";
  decision?: "approve" | "changes" | "cancelled";
}) {
  const stat = useRevisionStat(doc);
  const sessionId = useSession((s) => s.sessionId!);
  const [busy, setBusy] = useState<"approve" | "changes" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  if (status !== "pending") {
    const text =
      status === "expired"
        ? "This plan proposal expired when the session restarted."
        : decision === "approve"
          ? "Plan approved. Claude is implementing it."
          : decision === "changes"
            ? "Changes requested. Claude is revising the plan."
            : "Plan proposal was cancelled.";
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {decision === "approve" && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
        {text}
      </p>
    );
  }

  const approve = async (nextMode: string) => {
    setBusy("approve");
    setError(null);
    try {
      const { editedMarkdown } = collectRevision(doc);
      await api.approvePlan(sessionId, { requestId, documentId: doc.id, editedMarkdown, nextMode });
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const requestChanges = async () => {
    setBusy("changes");
    setError(null);
    try {
      await api.requestPlanChanges(sessionId, {
        requestId,
        documentId: doc.id,
        version: doc.version,
        ...collectRevision(doc),
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="bg-muted/60 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        {stat.dirty
          ? `${plural(stat.hunks, "edit")}, ${plural(stat.comments, "comment")}`
          : "Review the plan. Edit or comment to request changes."}
      </span>
      {error && <span className="text-destructive text-xs">{error}</span>}
      <div className="ml-auto flex items-center gap-2">
        {stat.dirty && (
          <Button size="sm" variant="ghost" onClick={() => setReviewing(true)}>
            Review diff
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={!stat.dirty || busy !== null} onClick={requestChanges}>
          {busy === "changes" && <Loader2Icon className="animate-spin" />}
          Request changes
        </Button>
        <div className="flex">
          <Button
            size="sm"
            className="rounded-r-none"
            disabled={busy !== null}
            onClick={() => approve("acceptEdits")}
          >
            {busy === "approve" ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {stat.hunks > 0 ? "Approve edited plan" : "Approve"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="border-primary-foreground/20 rounded-l-none border-l px-1.5" disabled={busy !== null}>
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => approve("acceptEdits")}>Approve, auto-accept edits</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => approve("default")}>Approve, ask before edits</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <RevisionDialog doc={doc} open={reviewing} onOpenChange={setReviewing} />
    </div>
  );
}
