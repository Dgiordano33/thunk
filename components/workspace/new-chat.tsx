"use client";

import { useRouter } from "next/navigation";
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

/** A blank chat. The session is only created when the first message is sent. */
export function NewChat({
  workspaceId,
  workspaceLabel,
  defaultModel,
  defaultMode,
  disabled,
}: {
  workspaceId: string;
  workspaceLabel: string;
  defaultModel: string;
  defaultMode: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [model, setModel] = useState(defaultModel);
  const [mode, setMode] = useState(defaultMode);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const models = MODELS.some((m) => m.id === model) ? MODELS : [...MODELS, { id: model, label: model }];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {disabled ? (
          <p className="text-muted-foreground text-sm">This workspace is archived. Unarchive it to start a chat.</p>
        ) : (
          <>
            <p className="text-sm font-medium">New chat in {workspaceLabel}</p>
            <p className="text-muted-foreground mt-1 text-sm">Claude&apos;s replies arrive as documents you can edit and comment on.</p>
          </>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-5">
        <PromptInput
          onSubmit={async ({ text }) => {
            if (!text.trim() || submitting) return;
            setError(null);
            setSubmitting(true);
            try {
              const { id } = await api.createSession({ workspaceId, model, permissionMode: mode, prompt: text });
              router.push(`/w/${workspaceId}/s/${id}`);
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
              setSubmitting(false);
            }
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea autoFocus disabled={disabled || submitting} placeholder="Ask Claude to do something…" />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputSelect value={model} onValueChange={setModel} disabled={disabled}>
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
              <PromptInputSelect value={mode} onValueChange={setMode} disabled={disabled}>
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
            <PromptInputSubmit disabled={disabled} status={submitting ? "submitted" : "ready"} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
