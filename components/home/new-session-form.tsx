"use client";

import { FolderIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MODELS, PERMISSION_MODES } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { MODE_LABELS } from "@/components/session/labels";

export function NewSessionForm({
  defaultCwd,
  defaultModel,
  recentCwds,
}: {
  defaultCwd: string;
  defaultModel: string;
  recentCwds: string[];
}) {
  const router = useRouter();
  const [cwd, setCwd] = useState(defaultCwd);
  const [model, setModel] = useState(defaultModel);
  const [mode, setMode] = useState<string>("default");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { id } = await api.createSession({ cwd, model, permissionMode: mode, prompt });
      router.push(`/s/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Workspace directory</span>
        <div className="relative">
          <FolderIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="~/code/my-project"
            className="pl-8 font-mono text-sm"
            list="recent-cwds"
            autoFocus={!defaultCwd}
          />
          <datalist id="recent-cwds">
            {recentCwds.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Model</span>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Permission mode</span>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERMISSION_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          First message <span className="text-muted-foreground font-normal">(optional)</span>
        </span>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should we work on?"
          rows={4}
          autoFocus={Boolean(defaultCwd)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
      </label>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Button type="submit" disabled={pending || !cwd.trim()} className="self-end">
        {pending && <Loader2Icon className="animate-spin" />}
        Start session
        <kbd className="text-primary-foreground/70 ml-1 text-[11px]">⌘↵</kbd>
      </Button>
    </form>
  );
}
