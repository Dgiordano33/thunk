"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import type { NoteScope } from "@/lib/notes/types";

export function NewRepoNote({ scope, onClose, onCreated }: { scope: NoteScope; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(null);
      try { const result = await api.createNote(scope.kind, scope.id, { id, title }); onCreated(result.note.id); }
      catch (err) { setError((err as Error).message); setBusy(false); }
    }} className="space-y-4">
      <DialogHeader><DialogTitle>New repo note</DialogTitle><DialogDescription>Creates a Markdown file in the registered checkout.</DialogDescription></DialogHeader>
      <label className="block space-y-1 text-sm">Title<Input value={title} maxLength={200} required onChange={(e) => { setTitle(e.target.value); if (!custom) setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)); }} /></label>
      <label className="block space-y-1 text-sm">Filename (without .md)<Input value={id} required pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}" maxLength={64} onChange={(e) => { setCustom(true); setId(e.target.value); }} /></label>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <DialogFooter><Button disabled={busy || !id || id.toLowerCase() === "memory"}>Create note</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
