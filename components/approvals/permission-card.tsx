"use client";

import { CheckIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { toolSummary } from "@/components/chat/tool-call";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", json: "json", md: "markdown",
  py: "python", rb: "ruby", go: "go", rs: "rust", css: "css", html: "html", sh: "bash", yml: "yaml", yaml: "yaml",
  sql: "sql", toml: "toml",
};

function langFor(path: unknown) {
  const ext = typeof path === "string" ? path.split(".").pop()?.toLowerCase() : undefined;
  return (ext && EXT_LANG[ext]) || "markdown";
}

function previewOf(toolName: string, input: Record<string, unknown>) {
  if (toolName === "Bash" && typeof input.command === "string") return { code: input.command, lang: "bash" };
  if (toolName === "Write" && typeof input.content === "string")
    return { code: input.content, lang: langFor(input.file_path) };
  if (toolName === "Edit" && typeof input.new_string === "string")
    return { code: `- ${String(input.old_string ?? "").replace(/\n/g, "\n- ")}\n+ ${input.new_string.replace(/\n/g, "\n+ ")}`, lang: "diff" };
  return { code: JSON.stringify(input, null, 2), lang: "json" };
}

export function PermissionCard({ requestId }: { requestId: string }) {
  const req = useSession((s) => s.requests[requestId]);
  const sessionId = useSession((s) => s.sessionId!);
  const [denying, setDenying] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!req || req.kind !== "permission") return null;

  const input = (req.input ?? {}) as Record<string, unknown>;
  const pending = req.status === "pending";
  const { code, lang } = previewOf(req.toolName, input);
  const canAlways = Boolean(req.suggestions?.length);

  const decide = async (decision: "allow" | "allow_always" | "deny") => {
    setBusy(true);
    setError(null);
    try {
      await api.permission(sessionId, { requestId, decision, message: decision === "deny" ? message : undefined });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!pending) {
    const label =
      req.status === "expired"
        ? "expired"
        : req.decision === "allow"
          ? "allowed"
          : req.decision === "deny"
            ? "denied"
            : "cancelled";
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {req.decision === "allow" ? <CheckIcon className="size-3.5" /> : <XIcon className="size-3.5" />}
        {req.toolName} {toolSummary(req.toolName, input) && `· ${toolSummary(req.toolName, input)}`} — {label}
      </p>
    );
  }

  return (
    <div className={cn("rounded-xl border border-amber-500/40 bg-amber-500/5 p-4")}>
      <div className="mb-3 flex items-start gap-2">
        <ShieldAlertIcon className="mt-0.5 size-4 text-amber-600" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{req.title ?? `Claude wants to use ${req.toolName}`}</p>
          {(req.description || req.decisionReason) && (
            <p className="text-muted-foreground mt-0.5 text-xs">{req.decisionReason ?? req.description}</p>
          )}
        </div>
      </div>
      <div className="mb-3 max-h-64 overflow-auto rounded-md border text-xs">
        <CodeBlock code={code} language={lang as never} />
      </div>
      {denying ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void decide("deny");
          }}
        >
          <Input
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell Claude what to do instead (optional)"
            className="h-8 text-sm"
          />
          <Button size="sm" variant="destructive" type="submit" disabled={busy}>
            Deny
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setDenying(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Decline first: an approval should never be one stray keystroke away. */}
          <Button size="sm" variant="outline" onClick={() => setDenying(true)} disabled={busy}>
            Deny…
          </Button>
          <Button size="sm" onClick={() => decide("allow")} disabled={busy}>
            Allow
          </Button>
          {canAlways && (
            <Button size="sm" variant="secondary" onClick={() => decide("allow_always")} disabled={busy}>
              Allow for this session
            </Button>
          )}
          {error && <span className="text-destructive text-xs">{error}</span>}
        </div>
      )}
    </div>
  );
}
