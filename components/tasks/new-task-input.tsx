"use client";
import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewTaskInput({ onCreate, onEdit }: { onCreate: (title: string) => Promise<void>; onEdit: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true); setError(null);
    try { await onCreate(title.trim()); setTitle(""); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="space-y-1">
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <Input aria-label="New task title" placeholder="Add a task…" value={title} maxLength={200} disabled={busy} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => {
        if (e.key === "Enter" && e.nativeEvent.isComposing) { e.preventDefault(); return; }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onEdit(title); }
      }} />
      <Button type="submit" size="icon" variant="outline" disabled={busy || !title.trim()} aria-label="Add task"><PlusIcon /></Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onEdit(title)}>Details</Button>
    </form>
    <p className="text-muted-foreground text-[11px]">Enter to add · ⌘/Ctrl Enter for details</p>
    {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
  </div>;
}
