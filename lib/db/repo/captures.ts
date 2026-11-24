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
 if(next.status==='ready' && row.status!=='ready' && next.project_id) {
 const {notify}=await import('@/lib/notifications/service');
 await notify({kind:'capture_ready',urgency:'action',projectId:next.project_id,workspaceId:next.workspace_id,sessionId:next.session_id,subjectKey:`capture:${next.id}`,title:next.title || next.text,detail:next.summary,href:'/inbox'});
 }
 return next;
 }
}
