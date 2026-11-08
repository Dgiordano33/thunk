"use client";

import { ClipboardPasteIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { VAULT_MAX_BYTES, VAULT_MAX_FILES, type VaultItem } from "@/lib/vault/types";

/** Drop, pick or paste content into the Vault. Files go up one per request. */
export function Dropzone({ projectId, onAdded, compact }: { projectId: string; onAdded: (items: VaultItem[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");

  async function upload(files: File[]) {
    setError(null);
    if (files.length > VAULT_MAX_FILES) {
      setError(`Up to ${VAULT_MAX_FILES} files at a time.`);
      return;
    }
    const tooBig = files.find((f) => f.size > VAULT_MAX_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is over ${VAULT_MAX_BYTES / 1024 / 1024}MB.`);
      return;
    }
    const failures: string[] = [];
    for (const [i, file] of files.entries()) {
      setUploading(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : `Uploading ${file.name}…`);
      try {
        onAdded((await api.uploadVault(projectId, { file })).items);
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    setUploading(null);
    if (failures.length) setError(failures.join(" · "));
  }

  async function submitText() {
    if (!text.trim()) return;
    setError(null);
    setUploading("Saving…");
    try {
      onAdded((await api.uploadVault(projectId, { text })).items);
      setText("");
      setPasting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the text");
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files to the Vault"
        onClick={() => !uploading && input.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!uploading) void upload([...e.dataTransfer.files]);
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            void upload(files);
          }
        }}
        className={cn(
          "bg-background text-muted-foreground hover:bg-muted/40 focus-visible:ring-ring flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 outline-none focus-visible:ring-2",
          compact ? "flex-wrap gap-y-1 py-2" : "py-4",
          over && "border-[var(--w-bronze)] bg-[color-mix(in_oklch,var(--w-bronze)_12%,transparent)]",
          uploading && "cursor-progress",
        )}
      >
        {uploading ? <Spinner className="size-4" /> : <UploadIcon className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 text-xs">
          {uploading ??
            (compact ? (
              <>
                <span className="text-foreground font-medium">Drop files</span> or click · up to {VAULT_MAX_BYTES / 1024 / 1024}MB
              </>
            ) : (
              <>
                <span className="text-foreground font-medium">Drop files</span> or click to choose. Docs, PDFs, images, slides, transcripts — up to{" "}
                {VAULT_MAX_BYTES / 1024 / 1024}MB each.
              </>
            ))}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className={cn("shrink-0 text-xs", compact && "-my-1 h-7 px-1.5")}
          onClick={(e) => {
            e.stopPropagation();
            setPasting((p) => !p);
          }}
          disabled={Boolean(uploading)}
        >
          <ClipboardPasteIcon /> Paste text
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void upload(files);
          }}
        />
      </div>
      {pasting && (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submitText();
              if (e.key === "Escape") e.stopPropagation();
            }}
            placeholder="Paste meeting notes, an article, a transcript…"
            className="max-h-60 min-h-28 text-xs"
            aria-label="Text to add to the Vault"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPasting(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void submitText()} disabled={!text.trim() || Boolean(uploading)}>Add to Vault</Button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
