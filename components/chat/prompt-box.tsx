"use client";
import { AgentStatus } from "@/components/onboarding/agent-status";

import { Button } from "@/components/ui/button";

import { AttachImagesButton, PromptComposer } from "@/components/chat/prompt-composer";
import { SquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { ModelSelect } from "@/components/chat/model-select";
import { MODE_LABELS } from "@/components/session/labels";
import { permissionModesFor, providerOf } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { useModels } from "@/lib/client/use-models";
import { useSession } from "@/lib/store/session-store";
import { useWorkspaceBase } from "@/components/workspace/route-context";

export function PromptBox({ onResume }: { onResume: () => Promise<void> }) {
  const router = useRouter();
  const base = useWorkspaceBase();
  const models = useModels();
  const sessionId = useSession((s) => s.sessionId!);
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const live = Boolean(meta?.live);
  const running = live && (status === "running" || status === "awaiting");
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const provider = providerOf(meta?.model);

  const control = (body: Parameters<typeof api.control>[1]) =>
    api.control(sessionId, body).catch((err: Error) => setError(err.message));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:pb-5">
      {!live && <p className="text-muted-foreground mb-2 text-xs">Paused · Send a message to resume.</p>}
      <AgentStatus onlyUnavailable={status !== "error" && !error} />
      <PromptComposer
        workspaceId={meta?.workspaceId ?? ""}
        disabled={submitting}
        placeholder={running ? "Queue a follow-up…" : "Ask the agent to do something…"}
        onSubmit={async ({ text, files }) => {
          if ((!text.trim() && !files.length) || submitting) throw new Error("Message unavailable");
          setError(null);
          setSubmitting(true);
          try {
            if (!live) await onResume();
            if (model) await api.control(sessionId, { action: "setModel", value: model });
            if (mode) await api.control(sessionId, { action: "setPermissionMode", value: mode });
            await api.send(sessionId, text, files);
            setModel(null);
            setMode(null);
          } catch (err) {
            setError((err as Error).message);
            throw err;
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <PromptInputFooter>
          <PromptInputTools>
            <AttachImagesButton disabled={submitting} />
            <ModelSelect
              models={models}
              value={model ?? meta?.model}
              onValueChange={(value) => {
                // A session can't change runtimes: the other provider's models open a new chat here.
                if (providerOf(value) === provider) { if (live) { setModel(null); void control({ action: "setModel", value }); } else setModel(value); }
                else if (meta) router.push(`${base}/new?model=${encodeURIComponent(value)}`);
              }}
              disabled={submitting}
            />
            <PromptInputSelect
              value={mode ?? meta?.permissionMode}
              onValueChange={(value) => { if (live) { setMode(null); void control({ action: "setPermissionMode", value }); } else setMode(value); }}
              disabled={submitting}
            >
              <PromptInputSelectTrigger className="h-7 min-w-0 shrink-[3] text-xs [&>[data-slot=select-value]]:!block [&>[data-slot=select-value]]:truncate">
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {permissionModesFor(provider).map((m) => (
                  <PromptInputSelectItem key={m} value={m}>
                    {MODE_LABELS[m]}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
            {error && <span className="text-destructive truncate text-xs">{error}</span>}
          </PromptInputTools>
          {running && <Button variant="ghost" size="xs" type="button" aria-label="Stop" className="text-muted-foreground max-md:text-foreground shrink-0 text-xs max-md:border-border" onClick={() => control({ action: "interrupt" })}><SquareIcon className="size-3.5 fill-current md:hidden" /><span className="max-md:hidden">Stop</span></Button>}
          <PromptInputSubmit
            aria-label={submitting ? "Sending message" : "Send message"}
            className="disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            disabled={submitting}
            status={submitting ? "submitted" : "ready"}
          />
        </PromptInputFooter>
      </PromptComposer>
    </div>
  );
}
