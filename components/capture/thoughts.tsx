"use client";
import type { Capture } from '@/lib/capture/types';
import type { Captures } from './use-captures';
import { CaptureInput } from './capture-input';

const STATE: Record<Capture['status'], string> = { routing: 'Routing', queued: 'Queued', working: 'Working', ready: 'Ready', kept: 'Kept', discarded: 'Discarded', failed: 'Couldn’t start' };
const minutes = (row: Capture) => Math.max(0, Math.round((Date.parse(row.updated_at) - Date.parse(row.created_at)) / 60000));

/**
 * The capture field and the thoughts that don't need you yet (routing, queued, working) or need a retry.
 * Ready thoughts are Decisions in the feed below, in time order with everything else; `inFeed` names those.
 */
export function Thoughts({ projects, captures, inFeed }: { projects: { id: string; name: string }[]; captures: Captures; inFeed: Set<string> }) {
  const { rows, limit, error, refresh, act, retry, rule, setRule } = captures;
  const quiet = rows.filter((r) => !inFeed.has(r.id));
  const name = (row: Capture) => projects.find((p) => p.id === row.project_id)?.name ?? 'Home';
  return <section aria-label="Thoughts" className="shrink-0 space-y-3 border-b px-5 py-4 sm:px-8">
    <CaptureInput disabled={rows.length >= limit} onSent={() => void refresh()} />
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    {rule && <p role="status" className="text-xs">Save this redirect as a Home routing rule? <button className="underline" onClick={() => { void act(rule.id, 'rule', rule.text); setRule(null); }}>Save rule</button> <button className="ml-2 underline" onClick={() => setRule(null)}>Not now</button></p>}
    {quiet.length > 0 && <ul aria-label="Thoughts in progress" className="max-h-48 space-y-1 overflow-y-auto">
      {quiet.map((row) => <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="min-w-0 flex-1 truncate" title={row.text}>{row.text}</span>
        <span className="text-muted-foreground shrink-0 text-xs">{row.status === 'routing' ? STATE.routing : `${STATE[row.status]} · ${name(row)}`}</span>
        {row.session_id && row.workspace_id && <a className="shrink-0 text-xs underline" href={`/w/${row.workspace_id}/s/${row.session_id}`}>Open session</a>}
        {row.status === 'ready' && <button className="shrink-0 text-xs underline" onClick={() => void act(row.id, 'keep')}>Keep</button>}
        {row.status !== 'routing' && <button className="shrink-0 text-xs underline" onClick={() => void act(row.id, 'discard')}>Discard</button>}
        {row.status === 'failed' && <RetryForm row={row} projects={projects} onRetry={retry} />}
      </li>)}
    </ul>}
  </section>;
}

function RetryForm({ row, projects, onRetry }: { row: Capture; projects: { id: string; name: string }[]; onRetry: (id: string, projectId?: string) => Promise<void> }) {
  return <form className="flex basis-full items-center gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); void onRetry(row.id, String(new FormData(e.currentTarget).get('projectId') || '') || undefined); }}>
    <span role="alert" className="text-destructive min-w-0 flex-1 truncate" title={row.error ?? ''}>{row.error}</span>
    <select name="projectId" aria-label="Retry project" className="rounded border bg-background px-1 py-0.5"><option value="">Choose automatically</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <button className="rounded border px-2 py-0.5">Retry</button>
  </form>;
}

/** The body of a ready thought's Decision card: You said, Assumed, Did, Next, and the redirect field. */
export function ThoughtReview({ row, tab, onRedirect }: { row: Capture; tab: number; onRedirect: (text: string) => void }) {
  return <div className="mt-2 space-y-2 text-sm">
    <p><span className="text-muted-foreground text-xs">You said </span>{row.text}</p>
    {row.assumptions.length > 0 && <p><span className="text-muted-foreground text-xs">Assumed </span>{row.assumptions.join(' · ')}</p>}
    {row.summary && <div><span className="text-muted-foreground text-xs">Did </span><span className="whitespace-pre-wrap">{row.summary}</span></div>}
    {row.next_step && <p><span className="text-muted-foreground text-xs">Next </span>{row.next_step}</p>}
    <p className="text-muted-foreground font-mono text-[11px]">${Number(row.cost_usd).toFixed(4)} · {minutes(row)} min since capture{row.diff_stat ? ` · ${JSON.stringify(row.diff_stat)}` : ''}</p>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get('text') ?? ''); onRedirect(text); }}>
      <input name="text" data-redirect="" tabIndex={tab} aria-label="Redirect thought" placeholder="Redirect this worker… (#project moves it)" required className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm" />
      <button tabIndex={tab} className="rounded border px-2 text-sm">Redirect</button>
    </form>
  </div>;
}
