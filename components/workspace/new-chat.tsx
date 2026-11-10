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
import { PROVIDER_LABELS, permissionModesFor, providerOf } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { useModels } from "@/lib/client/use-models";
import { useWorkspaceBase } from "./route-context";

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
  const base = useWorkspaceBase();
  const models = useModels();
  const [model, setModel] = useState(defaultModel);
  const provider = providerOf(model);
  const modes = permissionModesFor(provider);
  const [chosenMode, setMode] = useState(defaultMode);
  // Plan mode is Claude-only; fall back while a Codex model is picked.
  const mode = modes.includes(chosenMode as never) ? chosenMode : "default";
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {disabled ? (
          <p className="text-muted-foreground text-sm">This workspace is archived. Unarchive it to start a chat.</p>
        ) : (
          <>
            <p className="text-sm font-medium">New chat in {workspaceLabel}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {PROVIDER_LABELS[provider]}&apos;s replies arrive as documents you can edit and comment on.
            </p>
          </>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-5">
        <PromptComposer
          workspaceId={workspaceId}
          disabled={disabled || submitting}
          autoFocus
          placeholder="Ask the agent to do something…"
          onSubmit={async ({ text, files }) => {
            if ((!text.trim() && !files.length) || submitting) throw new Error("Message unavailable");
            setError(null);
            setSubmitting(true);
            try {
              const { id } = await api.createSession({ workspaceId, model, permissionMode: mode, prompt: text, images: files });
              router.push(`${base}/${id}`);
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
              setSubmitting(false);
              throw err;
            }
          }}
        >
          <PromptInputFooter>
            <PromptInputTools>
              <ModelSelect models={models} value={model} onValueChange={setModel} disabled={disabled} />
              <PromptInputSelect value={mode} onValueChange={setMode} disabled={disabled}>
                <PromptInputSelectTrigger className="h-7 text-xs">
                  <PromptInputSelectValue />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  {modes.map((m) => (
                    <PromptInputSelectItem key={m} value={m}>
                      {MODE_LABELS[m]}
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
              {error && <span className="text-destructive truncate text-xs">{error}</span>}
            </PromptInputTools>
            <PromptInputSubmit disabled={disabled || submitting} status={submitting ? "submitted" : "ready"} />
          </PromptInputFooter>
        </PromptComposer>
      </div>
    </div>
  );
}
