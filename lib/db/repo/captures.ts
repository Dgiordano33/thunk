import "server-only";
import { db } from '../server';
import { insertSql, updateSql, run } from '../sql';
import { emitCapture } from '@/lib/capture/events';
import type { Capture } from '@/lib/capture/types';
const g = globalThis as typeof globalThis & { __captures?: Map<string, Capture> };
const mem = g.__captures ??= new Map<string, Capture>();
export async function listCaptures(all = false): Promise<Capture[]> {
 const client = db();
 const rows = client ? await client.query<Capture>('select * from captures order by created_at desc') : [...mem.values()].reverse();
 return rows.filter(r => all || !['kept','discarded'].includes(r.status));
}
export async function saveCapture(row: Capture, insert = false) {
 const client = db(); row = { ...row, updated_at: new Date().toISOString() };
 if (client) await run(client, insert ? insertSql('captures', row) : updateSql('captures', row, 'id = $1', [row.id])!);
 else mem.set(row.id, row);
 emitCapture({id:row.id}); return row;
}
export async function captureTask(taskId: string, patch: Partial<Capture>) {
 const row = (await listCaptures()).find(r => r.task_id === taskId);
 if (row) { const next = await saveCapture({...row, ...patch});
 if(next.status==='ready' && row.status!=='ready') await notifyReady(next);
 return next;
 }
}
/** The Inbox Decision for a ready thought; it is what puts the thought in the feed. */
export async function notifyReady(row: Capture) {
 if (!row.project_id) return;
 const {notify}=await import('@/lib/notifications/service');
 await notify({kind:'capture_ready',urgency:'action',projectId:row.project_id,workspaceId:row.workspace_id,sessionId:row.session_id,subjectKey:`capture:${row.id}`,title:row.title || row.text,detail:row.summary,href:'/inbox'});
}
