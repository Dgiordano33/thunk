"use client";

import { useState } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { MODE_LABELS } from "@/components/session/labels";
import { MODELS, PERMISSION_MODES } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/store/session-store";

export function PromptBox() {
  const sessionId = useSession((s) => s.sessionId!);
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const live = Boolean(meta?.live);
  const running = status === "running" || status === "awaiting";
  const models = MODELS.some((m) => m.id === meta?.model)
    ? MODELS
    : [...MODELS, { id: meta?.model ?? "", label: meta?.model ?? "" }];

  const control = (body: Parameters<typeof api.control>[1]) =>
    api.control(sessionId, body).catch((err: Error) => setError(err.message));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-5">
      <PromptInput
        onSubmit={async ({ text }) => {
          if (!text.trim()) return;
          setError(null);
          setSubmitting(true);
          try {
            await api.send(sessionId, text);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            disabled={!live}
            placeholder={live ? (running ? "Queue a follow-up…" : "Ask Claude to do something…") : "Session is not live"}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputSelect
              value={meta?.model}
              onValueChange={(value) => control({ action: "setModel", value })}
              disabled={!live}
            >
              <PromptInputSelectTrigger className="h-7 text-xs">
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {models.map((m) => (
                  <PromptInputSelectItem key={m.id} value={m.id}>
                    {m.label}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
            <PromptInputSelect
              value={meta?.permissionMode}
              onValueChange={(value) => control({ action: "setPermissionMode", value })}
              disabled={!live}
            >
              <PromptInputSelectTrigger className="h-7 text-xs">
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {PERMISSION_MODES.map((m) => (
                  <PromptInputSelectItem key={m} value={m}>
                    {MODE_LABELS[m]}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
            {error && <span className="text-destructive truncate text-xs">{error}</span>}
          </PromptInputTools>
          <PromptInputSubmit
            disabled={!live}
            status={submitting ? "submitted" : running ? "streaming" : "ready"}
            onStop={() => control({ action: "interrupt" })}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
