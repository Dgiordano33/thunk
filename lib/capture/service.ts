import "server-only";
import { readFile } from 'node:fs/promises';
import { DATA_DIR } from '@/lib/projects/paths';
import { withFileLock } from '@/lib/notes/file-write';
import { listCaptures, notifyReady, saveCapture } from '@/lib/db/repo/captures';
import { resolveBySubject } from '@/lib/notifications/service';
import { updateWorkspace } from '@/lib/db/repo/workspaces';
import { patchTask } from '@/lib/tasks/service';
import { parseRoutingItems } from '@/lib/home/routing';
import { ensureHomeProject, routeTargets, saveRoutingRule } from '@/lib/home/service';
import { getTask, updateTask } from '@/lib/db/repo/tasks';
import { getProject } from '@/lib/db/repo/projects';
import { readWorkerState } from '@/lib/workers/state';
import { createTask } from '@/lib/tasks/service';
import { delegate, messageChief } from '@/lib/workers/service';
import { routeCapture } from './router';
import { captureBrief, captureTaskBody, relayMessage } from './prompt';
import type { Capture } from './types';
import { appendTurn } from './thread';
export async function captureLimit() {
 try { const config = JSON.parse(await readFile(`${DATA_DIR}/config/capture.json`,'utf8')); return Number.isInteger(config.maxOpen) && config.maxOpen > 0 ? config.maxOpen : 8; } catch { return 8; }
}
export async function createCapture(text: string) {
 return withFileLock('capture-create', async()=>{
 if (!text.trim() || text.length>10000) throw new Error('Enter a thought of at most 10,000 characters');
 if ((await listCaptures()).length >= await captureLimit()) throw new Error('Too many open thoughts. Close one before capturing another.');
 const now = new Date().toISOString();
 const row: Capture = {id:crypto.randomUUID(),text:text.trim(),status:'routing',project_id:null,task_id:null,workspace_id:null,session_id:null,mode:null,title:null,assumptions:[],next_step:null,summary:null,diff_stat:null,cost_usd:0,error:null,created_at:now,updated_at:now};
 await saveCapture(row,true); void dispatchCapture(row.id); return row;
 });
}
export async function dispatchCapture(id: string, projectId?: string) {
 return withFileLock(`capture:${id}`, async()=>{
 let row = (await listCaptures()).find(r=>r.id===id);
 if (!row || !['routing','failed'].includes(row.status)) return;
 try {
 if(row.task_id && row.project_id) {
 const task=await getTask(row.task_id);const project=await getProject(row.project_id);
 if(task?.sessionId && row.status==='routing') {await saveCapture({...row,status:task.status==='in_progress'?'working':'failed',session_id:task.sessionId,workspace_id:task.workspaceId,error:task.status==='in_progress'?null:'Interrupted during dispatch; inspect the session before retrying.'});return;}
 if(project && (await readWorkerState(project)).queue.some(q=>q.taskId===row!.task_id)){await saveCapture({...row,status:'queued'});return;}
 }
 row=await saveCapture({...row,status:'routing',error:null});
 const route=await routeCapture(row.text,projectId);
 const brief=captureBrief(row.text,route);
 // A thought that matches a project goes to that project's chief; only unmatched ones run as a Home scout.
 const toChief=route.projectId!==(await ensureHomeProject()).id;
 if (row.task_id && (toChief || row.project_id !== route.projectId)) {
 const previous=await getTask(row.task_id);
 if(previous?.sessionId && row.project_id) {const {stopWorker}=await import('@/lib/workers/service');await stopWorker(row.project_id,row.task_id,'Capture retry moved to another project');}
 else if(previous) await patchTask(previous.id,{status:'cancelled'});
 if(row.mode==='worktree' && row.workspace_id){const {archiveWorkspace}=await import('@/lib/projects/archive');await archiveWorkspace(row.workspace_id);}
 row=await saveCapture({...row,task_id:null,session_id:null,workspace_id:null});
 }
 if (toChief) {
 // Working before the message goes out, so a fast relay_report is never overwritten.
 row=await saveCapture({...row,status:'working',project_id:route.projectId,task_id:null,title:route.title,mode:null,assumptions:route.assumptions});
 const chief=await messageChief(route.projectId!,relayMessage(row.id,row.text,route));
 const current=(await listCaptures(true)).find(r=>r.id===id) ?? row;
 await saveCapture({...current,session_id:chief.sessionId,workspace_id:chief.workspaceId});
 return;
 }
 const task = row.task_id ? null : await createTask({projectId:route.projectId!,title:route.title,body:captureTaskBody(row.text,route)});
 row=await saveCapture({...row,project_id:route.projectId,task_id:task?.id ?? row.task_id,title:route.title,mode:route.mode,assumptions:route.assumptions});
 const result=await delegate(route.projectId!,null,{taskId:row.task_id!,title:route.title,brief,mode:route.mode,permissionMode:'acceptEdits'});
 // Launch writes working before sending the first brief; never overwrite a fast finish.
 if ('queued' in result) await saveCapture({...row,status:'queued'});
 } catch(e) { await saveCapture({...row,status:'failed',error:(e as Error).message}); }
 });
}
/** A project's chief settles a relayed thought: it becomes a Decision in the Inbox. */
export async function reportRelay(projectId: string, id: string, status: 'done'|'blocked', summary: string, nextStep?: string) {
 return withFileLock(`capture:${id}`, async()=>{
 const row=(await listCaptures()).find(r=>r.id===id);
 if(!row || row.project_id!==projectId || row.task_id) throw new Error('No relay with that id was sent to this project');
 if(!['working','ready','failed'].includes(row.status)) throw new Error('That relay is not waiting on a report');
 // A report after a reply continues the conversation instead of replacing it.
 const next=await saveCapture({...row,status:'ready',summary:appendTurn(row.summary,'chief',status==='blocked'?`Blocked: ${summary}`:summary),next_step:nextStep?.trim()||null,error:null});
 await notifyReady(next);
 return {reported:true};
 });
}
const decision=(id:string,action:string,text:string)=>`<relay_decision id="${id}" action="${action}">\n${text}\n</relay_decision>`;
export const RELAY_GRACE_MS = 5*60_000;
const BUSY = ['starting','running','awaiting'];
/**
 * A relay the chief dropped: its chief is idle, nothing it started is running or queued, and it has been quiet for the
 * grace period without a relay_report. It becomes a failed thought with Retry, not a row that says Working forever.
 * A late relay_report still settles it.
 */
export async function sweepRelays(now = Date.now()) {
 const stale=(await listCaptures()).filter(r=>r.status==='working' && !r.task_id && r.project_id && r.session_id && now-Date.parse(r.updated_at)>=RELAY_GRACE_MS);
 if(!stale.length) return 0;
 const {getSession,listLiveSessions}=await import('@/lib/agent');
 let swept=0;
 for(const row of stale) {
 if(BUSY.includes(getSession(row.session_id!)?.meta.status ?? '')) continue;
 if(listLiveSessions().some(s=>s.meta.projectId===row.project_id && s.meta.origin?.kind==='worker' && BUSY.includes(s.meta.status))) continue;
 const project=await getProject(row.project_id!);
 if(project && (await readWorkerState(project)).queue.length) continue;
 await withFileLock(`capture:${row.id}`, async()=>{
 const current=(await listCaptures()).find(r=>r.id===row.id);
 if(current?.status==='working' && current.updated_at===row.updated_at) {await saveCapture({...current,status:'failed',error:'The chief finished without reporting back. Open its session to see what happened, or retry.'});swept++;}
 });
 }
 return swept;
}
const g = globalThis as typeof globalThis & { __thunkRelaySweep?: ReturnType<typeof setInterval> };
export async function recoverCaptures() {
 for(const row of await listCaptures()) if(row.status==='routing') void dispatchCapture(row.id);
 // Pinned to globalThis so a dev hot reload replaces the timer instead of stacking another.
 if(g.__thunkRelaySweep) clearInterval(g.__thunkRelaySweep);
 g.__thunkRelaySweep=setInterval(()=>void sweepRelays().catch(e=>console.error('[thunk] relay sweep failed',e)),60_000);
 g.__thunkRelaySweep.unref?.();
}
export async function actOnCapture(id: string, action: string, text?: string) {
 return withFileLock(`capture:${id}`, async()=>{
 const row=(await listCaptures(true)).find(r=>r.id===id); if(!row) throw new Error('Thought not found');
 // Handled by the project's chief (no worker task of its own): decisions go to the chief as messages.
 const viaChief=!row.task_id && Boolean(row.project_id && row.session_id);
 const {messageWorker,stopWorker}=await import('@/lib/workers/service');
 if(action==='restore') {
 if(row.status!=='discarded') throw new Error('Only discarded thoughts can be restored');
 if((await listCaptures()).length >= await captureLimit()) throw new Error('Too many open thoughts');
 if(row.workspace_id && row.mode==='worktree') await updateWorkspace(row.workspace_id,{status:'active'});
 if(row.task_id) await updateTask(row.task_id,{status:'blocked'});
 const restored=await saveCapture({...row,status:row.summary?'ready':'failed',error:row.summary?null:'Restored. Retry or message the worker to resume.'});
 if(restored.status==='ready') await notifyReady(restored);
 return;
 }
 if(action==='rule') { if(!text?.trim()) throw new Error('Rule is required');await saveRoutingRule(text.trim());return; }
 if(action==='discard') {
 if(row.status==='routing') throw new Error('Wait for routing to finish');
 await saveCapture({...row,status:'discarded'});
 await resolveBySubject(`capture:${id}`);
 if(row.task_id && row.project_id) {
 const task=await getTask(row.task_id);
 if(task?.sessionId || row.status==='queued') await stopWorker(row.project_id,row.task_id,'Discarded capture');
 else if(task) await patchTask(task.id,{status:'cancelled'});
 }
 if(viaChief && ['working','ready'].includes(row.status)) await messageChief(row.project_id!,decision(id,'discard','The person discarded this. Stop any workers you started for it and cancel its open tasks.'));
 if(row.mode==='worktree' && row.workspace_id) { const {archiveWorkspace}=await import('@/lib/projects/archive');await archiveWorkspace(row.workspace_id); }
 return;
 }
 if(action==='keep' && row.status==='ready') {await saveCapture({...row,status:'kept'});await resolveBySubject(`capture:${id}`);return;}
 if(!['ready','failed'].includes(row.status)||(!row.task_id&&!viaChief)||!row.project_id||!row.session_id) throw new Error('Thought is not ready to continue');
 if(action!=='continue' && action!=='redirect') throw new Error('Unknown action');
 if(action==='redirect' && text?.trim()) {
 const target=parseRoutingItems('- [ ] '+text.replace(/\n/g,' '),await routeTargets())[0]?.target?.projectId;
 if(target && target!==row.project_id) {
 await saveCapture({...row,status:'discarded'});
 if(viaChief) await messageChief(row.project_id,decision(id,'discard','The person moved this to another project. Stop any workers you started for it and cancel its open tasks.'));
 else await stopWorker(row.project_id,row.task_id!,'Redirected capture');
 if(row.mode==='worktree' && row.workspace_id) {const {archiveWorkspace}=await import('@/lib/projects/archive');await archiveWorkspace(row.workspace_id);}
 await resolveBySubject(`capture:${id}`);
 await saveCapture({...row,text:row.text+'\n\nRedirect: '+text,status:'routing',project_id:null,task_id:null,workspace_id:null,session_id:null,summary:null,next_step:null,error:null});
 setTimeout(()=>void dispatchCapture(id,target),0); return;
 }
 }
 if(action==='continue' && !row.next_step?.trim()) throw new Error('No next step needs approval. Redirect the worker to request more work.');
 const content=action==='continue'? `Go ahead with this step only: ${row.next_step}` : text?.trim();
 if(!content)throw new Error('Enter a reply');
 await resolveBySubject(`capture:${id}`);
 await saveCapture({...row,status:'working',error:null,...(viaChief?{summary:appendTurn(row.summary,'you',content),next_step:null}:{})});
 try {if(viaChief) await messageChief(row.project_id,decision(id,action==='continue'?'go_ahead':'reply',content)); else await messageWorker(row.project_id,row.task_id!,content,row.session_id);}catch(e){await saveCapture(row);throw e;}
 });
}
