"use client";

import { CheckIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

const OTHER = "__other__";

export function AskQuestionForm({ requestId }: { requestId: string }) {
  const req = useSession((s) => s.requests[requestId]);
  const sessionId = useSession((s) => s.sessionId!);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!req || req.kind !== "question") return null;

  if (req.status !== "pending") {
    return (
      <div className="text-muted-foreground flex flex-col gap-1 text-xs">
        {req.questions.map((q) => (
          <p key={q.question} className="flex items-center gap-1.5">
            <CheckIcon className="size-3.5" />
            {q.header}: {req.answers?.[q.question] ?? (req.status === "expired" ? "expired" : "skipped")}
          </p>
        ))}
      </div>
    );
  }

  const toggle = (question: string, label: string, multi: boolean) =>
    setPicked((p) => {
      const cur = p[question] ?? [];
      if (!multi) return { ...p, [question]: [label] };
      return { ...p, [question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });

  const answerFor = (question: string) =>
    (picked[question] ?? [])
      .map((l) => (l === OTHER ? other[question]?.trim() : l))
      .filter(Boolean)
      .join(", ");

  const complete = req.questions.every((q) => answerFor(q.question));

  const submit = async (skip = false) => {
    setBusy(true);
    setError(null);
    try {
      await api.answer(sessionId, {
        requestId,
        answers: skip ? null : Object.fromEntries(req.questions.map((q) => [q.question, answerFor(q.question)])),
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-sky-500/40 bg-sky-500/5 p-4">
      {req.questions.map((q) => (
        <fieldset key={q.question} className="flex flex-col gap-2">
          <legend className="mb-2 flex items-start gap-2 text-sm font-medium">
            <MessageCircleQuestionIcon className="mt-0.5 size-4 text-sky-600" />
            {q.question}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...q.options, { label: OTHER, description: "Write your own answer" }].map((o) => {
              const selected = (picked[q.question] ?? []).includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => toggle(q.question, o.label, q.multiSelect)}
                  className={cn(
                    "bg-background rounded-lg border px-3 py-2 text-left transition-colors",
                    selected ? "border-sky-500 ring-1 ring-sky-500" : "hover:border-foreground/30",
                  )}
                >
                  <span className="block text-sm font-medium">{o.label === OTHER ? "Other" : o.label}</span>
                  <span className="text-muted-foreground block text-xs">{o.description}</span>
                </button>
              );
            })}
          </div>
          {(picked[q.question] ?? []).includes(OTHER) && (
            <Input
              autoFocus
              value={other[q.question] ?? ""}
              onChange={(e) => setOther((s) => ({ ...s, [q.question]: e.target.value }))}
              placeholder="Your answer"
              className="h-8 text-sm"
            />
          )}
        </fieldset>
      ))}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => submit()} disabled={!complete || busy}>
          Submit {req.questions.length > 1 ? "answers" : "answer"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => submit(true)} disabled={busy}>
          Skip
        </Button>
        {error && <span className="text-destructive text-xs">{error}</span>}
      </div>
    </div>
  );
}
