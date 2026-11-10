"use client";

import { PromptComposer } from "@/components/chat/prompt-composer";
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

export function PromptBox() {
  const router = useRouter();
  const base = useWorkspaceBase();
  const models = useModels();
  const sessionId = useSession((s) => s.sessionId!);
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const live = Boolean(meta?.live);
  const running = status === "running" || status === "awaiting";
  const provider = providerOf(meta?.model);

  const control = (body: Parameters<typeof api.control>[1]) =>
    api.control(sessionId, body).catch((err: Error) => setError(err.message));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-5">
      <PromptComposer
        workspaceId={meta?.workspaceId ?? ""}
        disabled={!live || submitting}
        placeholder={live ? (running ? "Queue a follow-up…" : "Ask the agent to do something…") : "Session is not live"}
        onSubmit={async ({ text, files }) => {
          if ((!text.trim() && !files.length) || submitting) throw new Error("Message unavailable");
          setError(null);
          setSubmitting(true);
          try {
            await api.send(sessionId, text, files);
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
            <ModelSelect
              models={models}
              value={meta?.model}
              onValueChange={(value) => {
                // A session can't change runtimes: the other provider's models open a new chat here.
                if (providerOf(value) === provider) void control({ action: "setModel", value });
                else if (meta) router.push(`${base}/new?model=${encodeURIComponent(value)}`);
              }}
              disabled={!live}
            />
            <PromptInputSelect
              value={meta?.permissionMode}
              onValueChange={(value) => control({ action: "setPermissionMode", value })}
              disabled={!live}
            >
              <PromptInputSelectTrigger className="h-7 text-xs">
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
          {running && <button type="button" className="text-muted-foreground text-xs" onClick={() => control({ action: "interrupt" })}>Stop</button>}
          <PromptInputSubmit
            disabled={!live || submitting}
            status={submitting ? "submitted" : "ready"}
          />
        </PromptInputFooter>
      </PromptComposer>
    </div>
  );
}
