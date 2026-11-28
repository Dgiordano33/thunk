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
import { isQueued, listQueue, racesForTask, relayTaskIds } from '@/lib/db/repo/worker-state';
import { hasPendingPlanForRelay } from '@/lib/db/repo/delegation-plans';
import { createTask } from '@/lib/tasks/service';
import { delegate, messageChief } from '@/lib/workers/service';
import { routeCapture } from './router';
import { captureBrief, captureTaskBody, relayMessage } from './prompt';
import type { Capture } from './types';
import { appendTurn } from './thread';
import { loadEvents } from '@/lib/db/repo/messages';
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
 if (row.status === 'failed' && row.session_id && row.project_id) {
   if (projectId && projectId !== row.project_id) throw new Error('Resume in the original project, then redirect explicitly if needed.');
   await resumeCapture(row); return;
 }
 if(row.task_id && row.project_id) {
 const task=await getTask(row.task_id);const project=await getProject(row.project_id);
 if(task?.sessionId && row.status==='routing') {await saveCapture({...row,status:task.status==='in_progress'?'working':'failed',session_id:task.sessionId,workspace_id:task.workspaceId,error:task.status==='in_progress'?null:'Interrupted during dispatch; inspect the session before retrying.'});return;}
 if(project && await isQueued(row.task_id)){await saveCapture({...row,status:'queued'});return;}
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
 // Save a receipt before sending; reportRelay shares this lock so it cannot be overwritten.
 row=await saveCapture({...row,status:'queued',message_id:crypto.randomUUID(),project_id:route.projectId,task_id:null,title:route.title,mode:null,assumptions:route.assumptions});
 const chief=await messageChief(route.projectId!,relayMessage(row.id,row.text,route),row.message_id!,async target => { row=await saveCapture({...row!,session_id:target.sessionId,workspace_id:target.workspaceId}); });
 const current=(await listCaptures(true)).find(r=>r.id===id) ?? row;
 await saveCapture({...current,status:chief.queued?'queued':'working',session_id:chief.sessionId,workspace_id:chief.workspaceId});
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
 if(!['queued','working','ready','failed'].includes(row.status)) throw new Error('That relay is not waiting on a report');
 const { getSession } = await import('@/lib/agent');
 const events = row.session_id ? getSession(row.session_id)?.events ?? [] : [];
 const receipt = events.find(e => e.type === 'user_message' && e.messageId === row.message_id);
 if (receipt?.type === 'user_message' && receipt.queued && !events.some(e => e.type === 'message_dequeued' && e.messageId === row.message_id))
   throw new Error('The person has a newer reply queued. Answer it after it is delivered before settling this relay.');
 // A report after a reply continues the conversation instead of replacing it.
 const next=await saveCapture({...row,status:'ready',summary:appendTurn(row.summary,'chief',status==='blocked'?`Blocked: ${summary}`:summary),next_step:nextStep?.trim()||null,error:null});
 await notifyReady(next);
 return {reported:true};
 });
}
const decision=(id:string,action:string,text:string)=>`<relay_decision id="${id}" action="${action}">\n${text}\n</relay_decision>`;
// Short allowance for a result and its report to finish persisting, not a generic failure timeout.
export const RELAY_GRACE_MS = 30_000;
const BUSY = ['starting','running','awaiting'];

/** Inspect this request's saved tasks; unrelated workers cannot hide a stopped request. */
async function relayLedger(row: Capture) {
 const ids = row.project_id ? await relayTaskIds(row.id) : [];
 const tasks = (await Promise.all(ids.map(getTask))).filter(t => t !== null);
 const project = row.project_id ? await getProject(row.project_id) : null;
 const queued = row.project_id ? (await listQueue(row.project_id)).some(q=>q.input?.relayId===row.id) : false;
 return { project, tasks, queued };
}

/** Resume the same request and task ledger. No routing or fresh delegation takes place here. Caller holds the capture lock. */
async function resumeCapture(row: Capture) {
 if (!row.project_id || !row.session_id) throw new Error('This request has no session to resume');
 const { tasks } = await relayLedger(row);
 const ledger = tasks.map(t => `- ${t.id}: ${t.title} — ${t.status}; session ${t.sessionId ?? 'not started'}`).join('\n');
 const content = `<relay_resume id="${row.id}">\nResume only unfinished work for this request. Inspect existing tasks, reports and workspaces before acting. Do not repeat completed tasks or consequential actions. Reuse workers_message for unfinished workers; do not re-delegate completed work. This is not approval for any new consequential action. If the work is already complete, call relay_report with the result.\nOriginal request: ${row.text}\nConversation:\n${row.summary ?? '(no answer yet)'}\nStopped: ${row.error ?? 'Interrupted'}\nSaved tasks:\n${ledger || 'No linked tasks. Check the chief history and existing project tasks before creating anything.'}\n</relay_resume>`;
 let next = await saveCapture({...row,status:'queued',message_id:crypto.randomUUID(),error:null});
 try {
   if (row.task_id) {
     const { messageWorker } = await import('@/lib/workers/service');
     const task = await getTask(row.task_id);
     if (task?.status === 'done') {
       const ready = await saveCapture({...row,status:'ready',error:null}); await notifyReady(ready); return;
     }
     await messageWorker(row.project_id,row.task_id,`Resume only unfinished work on your existing task. Inspect the current workspace and previous reports; preserve completed work and do not repeat consequential actions. No new approval is granted.\nOriginal request: ${row.text}\nPrevious report: ${row.summary ?? '(none)'}\nStopped: ${row.error ?? 'Interrupted'}`,row.session_id);
     await saveCapture({...next,status:'working'});
   } else {
     const chief = await messageChief(row.project_id,content,next.message_id!,async target => { next=await saveCapture({...next,session_id:target.sessionId,workspace_id:target.workspaceId}); });
     await saveCapture({...next,status:chief.queued?'queued':'working',session_id:chief.sessionId,workspace_id:chief.workspaceId});
   }
   await resolveBySubject(`capture:${row.id}`);
 } catch(e) { await saveCapture({...next,status:'failed',error:`Could not resume: ${(e as Error).message}`}); throw e; }
}

/** Reconcile durable receipts with the live queue and terminal events, including after a server restart. */
export async function sweepRelays(now = Date.now()) {
 const rows=(await listCaptures()).filter(r=>['queued','working'].includes(r.status) && !r.task_id && r.project_id);
 const {getSession}=await import('@/lib/agent');
 let swept=0;
 for(const row of rows) {
   if (!row.session_id && now-Date.parse(row.updated_at)<RELAY_GRACE_MS) continue;
   const live=row.session_id ? getSession(row.session_id) : undefined;
   const events=live?.events ?? (row.session_id ? await loadEvents(row.session_id) : []);
   const receipt=events.find(e=>e.type==='user_message' && e.messageId===row.message_id);
   const dequeued=events.find(e=>e.type==='message_dequeued' && e.messageId===row.message_id);
   const waiting=receipt?.type==='user_message' && receipt.queued && !dequeued;
   const {project,tasks,queued:workersQueued}=await relayLedger(row);
   const races=(await Promise.all(tasks.map(t=>racesForTask(t.id)))).flat();
   const sessionIds=[...new Set(tasks.flatMap(t=>[t.sessionId, ...races.filter(r=>r.taskId===t.id).flatMap(r=>r.entries.map(e=>e.sessionId))]).filter((id): id is string => Boolean(id)))];
   const workersBusy=sessionIds.some(id=>BUSY.includes(getSession(id)?.meta.status ?? ''));
   // A finished worker's report waits in a batch before it reaches the chief; it is still in flight.
   const {savedReports}=await import('@/lib/workers/report-up');
   const reportsPending=project ? (await Promise.all(sessionIds.map(id=>savedReports(project,id)))).some(rs=>rs.some(r=>!r.delivered)) : false;
   const planPending=await hasPendingPlanForRelay(row.id);
   const outstanding=Boolean(workersBusy || workersQueued || reportsPending || planPending);
   const terminal=!live || ['closed','error'].includes(live.meta.status);
   let error: string | null=null;
   const latestError=events.findLast(e=>e.type==='error' && e.seq > (dequeued?.seq ?? receipt?.seq ?? 0));
   // Outstanding work reports back to the chief, which is resumed then, so a stopped chief alone does not fail the request.
   if (terminal && !outstanding) {
     error=!row.session_id ? 'Dispatch stopped before a chief session was attached. Retry to deliver this request.' : latestError?.type==='error' ? `The chief stopped: ${latestError.message}` : 'The chief session stopped or the server restarted before it answered.';
   } else if (outstanding || waiting || BUSY.includes(live!.meta.status)) {
     if (!terminal && !waiting && row.status==='queued') await withFileLock(`capture:${row.id}`,async()=>{
       const current=(await listCaptures()).find(r=>r.id===row.id);
       if(current?.status==='queued' && current.message_id===row.message_id) await saveCapture({...current,status:'working'});
     });
     continue;
   } else if (now-Date.parse(row.updated_at)>=RELAY_GRACE_MS) {
     const result=events.findLast(e=>e.type==='result');
     error=result?.type==='result' && result.isError
       ? `The chief's turn failed${latestError?.type==='error' ? `: ${latestError.message}` : ' before it answered.'}`
       : 'The chief finished its turn without reporting back to this conversation.';
   }
   if (!error) continue;
   const complete=tasks.filter(t=>t.status==='done').length;
   const blocked=tasks.filter(t=>t.status==='blocked').map(t=>t.title);
   const explanation=`${error} ${complete ? `${complete} completed task${complete===1?'':'s'} will be preserved. ` : ''}${blocked.length ? `Blocked tasks: ${blocked.join(', ')}. ` : ''}Resume checks existing work and continues only what is unfinished.`;
   await withFileLock(`capture:${row.id}`,async()=>{
     const current=(await listCaptures()).find(r=>r.id===row.id);
     if(current && ['working','queued'].includes(current.status) && current.updated_at===row.updated_at) {
       await saveCapture({...current,status:'failed',error:explanation}); swept++;
     }
   });
 }
 return swept;
}
const g = globalThis as typeof globalThis & { __thunkRelaySweep?: ReturnType<typeof setInterval> };
export async function recoverCaptures() {
 for(const row of await listCaptures()) if(row.status==='routing') void dispatchCapture(row.id);
 await sweepRelays();
 if(g.__thunkRelaySweep) clearInterval(g.__thunkRelaySweep);
 g.__thunkRelaySweep=setInterval(()=>void sweepRelays().catch(e=>console.error('[thunk] relay sweep failed',e)),10_000);
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
 const restored=await saveCapture({...row,status:row.summary?'ready':'failed',error:row.summary?null:'Restored. Resume unfinished work to continue from the saved session.'});
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
 if(action==='resume') { if(row.status!=='failed') throw new Error('Only interrupted requests can be resumed'); await resumeCapture(row); return; }
 if((action==='keep' || action==='close') && row.status==='ready') {await saveCapture({...row,status:'kept'});await resolveBySubject(`capture:${id}`);return;}
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
 let next=await saveCapture({...row,status:viaChief?'queued':'working',message_id:crypto.randomUUID(),error:null,...(viaChief?{summary:appendTurn(row.summary,'you',content),next_step:null}:{})});
 try {
   if(viaChief) {
     const chief=await messageChief(row.project_id,decision(id,action==='continue'?'go_ahead':'reply',content),next.message_id!,async target => { next=await saveCapture({...next,session_id:target.sessionId,workspace_id:target.workspaceId}); });
     await saveCapture({...next,status:chief.queued?'queued':'working',session_id:chief.sessionId,workspace_id:chief.workspaceId});
   } else await messageWorker(row.project_id,row.task_id!,content,row.session_id);
   await resolveBySubject(`capture:${id}`);
 } catch(e) { await saveCapture({...next,status:'failed',error:`Reply was not delivered: ${(e as Error).message}. Resume to continue from this reply.`}); throw e; }
 });
}
