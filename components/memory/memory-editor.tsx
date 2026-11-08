"use client";

import { BrainIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";

/** Edit a project's or workspace's MEMORY.md in place. Agents read and write the same file. */
export function MemoryEditor({
  scope,
  id,
  title,
  hint,
}: {
  scope: "projects" | "workspaces";
  id: string;
  title: string;
  hint: string;
}) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getMemory(scope, id)
      .then((m) => {
        if (cancelled) return;
        setPath(m.path);
        setContent(m.content);
        setSaved(m.content);
      })
      .catch((err) => !cancelled && setError((err as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [scope, id]);

  const dirty = content !== saved;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.putMemory(scope, id, content, saved);
      setSaved(content);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <BrainIcon className="text-muted-foreground size-4" />
        <h2 className="text-sm font-medium">{title}</h2>
        {dirty && (
          <Button size="sm" variant="secondary" className="ml-auto h-7" onClick={save} disabled={saving}>
            {saving && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
      {loading ? (
        <div className="bg-muted/40 h-32 animate-pulse rounded-md" />
      ) : (
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          className="font-mono text-xs leading-relaxed"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (dirty) void save();
            }
          }}
        />
      )}
      {path && (
        <p className="text-muted-foreground truncate font-mono text-[10px]" title={path}>
          {path.replace(/^\/Users\/[^/]+/, "~")}
        </p>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </section>
  );
}
