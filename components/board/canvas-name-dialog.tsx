'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { canvasPath } from '@/lib/routes';
import type { CanvasSession } from '@/lib/board/types';

/** Asks for a canvas name. `onSubmit` does the work; a thrown error stays in the dialog. */
export function CanvasNameDialog({ open, onOpenChange, title, description, submitLabel, busyLabel, initial = '', onSubmit }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    submitLabel: string;
    busyLabel: string;
    initial?: string;
    onSubmit: (name: string) => Promise<void>;
}) {
    const [name, setName] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) { setName(initial); setError(''); }
    }
    const submit = async () => {
        const value = name.trim();
        if (!value || busy) return;
        setBusy(true);
        setError('');
        try { await onSubmit(value); onOpenChange(false); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
    };
    return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <label htmlFor="canvas-session-name" className="text-sm">Name</label>
          <Input id="canvas-session-name" autoFocus placeholder="e.g. Research or Launch plan" maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={busy}/>
          {error && <p role="alert" className="text-destructive mt-2 text-xs">{error}</p>}
          <DialogFooter className="mt-4"><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? busyLabel : submitLabel}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>;
}

/** Creates a canvas and opens it. `beforeLeave` saves the canvas being left, when there is one. */
export function NewCanvasDialog({ open, onOpenChange, project, beforeLeave }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: { id: string; slug: string };
    beforeLeave?: () => Promise<void>;
}) {
    const router = useRouter();
    return <CanvasNameDialog open={open} onOpenChange={onOpenChange} title="New canvas" description="Give this canvas a name. Each canvas has its own content and agent conversation." submitLabel="Create canvas" busyLabel="Creating…"
      onSubmit={async name => {
          await beforeLeave?.();
          const r = await fetch(`/api/projects/${project.id}/boards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
          const data = await r.json() as { session?: CanvasSession; error?: string };
          if (!r.ok || !data.session) throw new Error(data.error || 'Could not create the canvas');
          router.push(canvasPath(project, data.session.id));
          // The sidebar lists canvases from the shell layout, which a push alone keeps.
          router.refresh();
      }}/>;
}
