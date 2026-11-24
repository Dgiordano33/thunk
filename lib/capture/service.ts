import "server-only";
import { readFile } from 'node:fs/promises';
import { DATA_DIR } from '@/lib/projects/paths';
import { withFileLock } from '@/lib/notes/file-write';
import { listCaptures, notifyReady, saveCapture } from '@/lib/db/repo/captures';
import { resolveBySubject } from '@/lib/notifications/service';
import { updateWorkspace } from '@/lib/db/repo/workspaces';
import { patchTask } from '@/lib/tasks/service';
import { parseRoutingItems } from '@/lib/home/routing';
import { routeTargets, saveRoutingRule } from '@/lib/home/service';
import { getTask, updateTask } from '@/lib/db/repo/tasks';
import { getProject } from '@/lib/db/repo/projects';
import { readWorkerState } from '@/lib/workers/state';
import { createTask } from '@/lib/tasks/service';
import { delegate } from '@/lib/workers/service';
import { routeCapture } from './router';
import type { Capture } from './types';
const RULES = `First-crack rules: work only in your assigned workspace. Do not push, open a PR, merge, deploy, send or post anything. Do not ask questions unless truly blocked. End with needs_person: naming the next step held back. Scouts must remain read-only.`;
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
 const brief=route.brief+'\n\n'+RULES;
 if (row.task_id && row.project_id !== route.projectId) {
 const previous=await getTask(row.task_id);
 if(previous?.sessionId && row.project_id) {const {stopWorker}=await import('@/lib/workers/service');await stopWorker(row.project_id,row.task_id,'Capture retry moved to another project');}
 else if(previous) await patchTask(previous.id,{status:'cancelled'});
 if(row.mode==='worktree' && row.workspace_id){const {archiveWorkspace}=await import('@/lib/projects/archive');await archiveWorkspace(row.workspace_id);}
 row=await saveCapture({...row,task_id:null,session_id:null,workspace_id:null});
 }
 const task = row.task_id ? null : await createTask({projectId:route.projectId!,title:route.title,body:brief});
 row=await saveCapture({...row,project_id:route.projectId,task_id:task?.id ?? row.task_id,title:route.title,mode:route.mode,assumptions:route.assumptions});
 const result=await delegate(route.projectId!,null,{taskId:row.task_id!,title:route.title,brief,mode:route.mode,permissionMode:'acceptEdits'});
 // Launch writes working before sending the first brief; never overwrite a fast finish.
 if ('queued' in result) await saveCapture({...row,status:'queued'});
 } catch(e) { await saveCapture({...row,status:'failed',error:(e as Error).message}); }
 });
}
export async function recoverCaptures() { for(const row of await listCaptures()) if(row.status==='routing') void dispatchCapture(row.id); }
export async function actOnCapture(id: string, action: string, text?: string) {
 return withFileLock(`capture:${id}`, async()=>{
 const row=(await listCaptures(true)).find(r=>r.id===id); if(!row) throw new Error('Thought not found');
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
 if(row.mode==='worktree' && row.workspace_id) { const {archiveWorkspace}=await import('@/lib/projects/archive');await archiveWorkspace(row.workspace_id); }
 return;
 }
 if(action==='keep' && row.status==='ready') {await saveCapture({...row,status:'kept'});await resolveBySubject(`capture:${id}`);return;}
 if(!['ready','failed'].includes(row.status)||!row.task_id||!row.project_id||!row.session_id) throw new Error('Thought is not ready to continue');
 if(action!=='continue' && action!=='redirect') throw new Error('Unknown action');
 if(action==='redirect' && text?.trim()) {
 const target=parseRoutingItems('- [ ] '+text.replace(/\n/g,' '),await routeTargets())[0]?.target?.projectId;
 if(target && target!==row.project_id) {
 await saveCapture({...row,status:'discarded'});
 await stopWorker(row.project_id,row.task_id,'Redirected capture');
 if(row.mode==='worktree' && row.workspace_id) {const {archiveWorkspace}=await import('@/lib/projects/archive');await archiveWorkspace(row.workspace_id);}
 await resolveBySubject(`capture:${id}`);
 await saveCapture({...row,text:row.text+'\n\nRedirect: '+text,status:'routing',project_id:null,task_id:null,workspace_id:null,session_id:null,summary:null,next_step:null,error:null});
 setTimeout(()=>void dispatchCapture(id,target),0); return;
 }
 }
 const content=action==='continue'? `Go ahead with this step only: ${row.next_step || 'Complete the work and report back.'}` : text?.trim();
 if(!content)throw new Error('Enter a redirect');
 await resolveBySubject(`capture:${id}`);
 await saveCapture({...row,status:'working',error:null});
 try {await messageWorker(row.project_id,row.task_id,content,row.session_id);}catch(e){await saveCapture(row);throw e;}
 });
}
