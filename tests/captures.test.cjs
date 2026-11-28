/* eslint-disable @typescript-eslint/no-require-imports -- Load the TypeScript sources with the installed compiler. */
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const resolve=Module._resolveFilename;
Module._resolveFilename=function(r,...args){if(r.startsWith('@/')){const base=path.join(__dirname,'..',r.slice(2));r=[base+'.ts',base+'.tsx'].find(fs.existsSync)||base;}return resolve.call(this,r,...args);};

// Fakes for everything a capture touches outside its own table. `calls` records what the service asked for.
let reports, plans, calls, tasks, queue, delegateResult, notified, resolved, routingResult, live, relayTasks, chiefQueued, chiefError, savedEvents;
const reset=()=>{reports={};plans={};relayTasks={};chiefQueued=false;chiefError=null;savedEvents=[];live=[];routingResult=null;calls=[];tasks=new Map();queue=[];delegateResult={taskId:'t1'};notified=[];resolved=[];globalThis.__captures?.clear();};
reset();
const workers={
 delegate:async(projectId,chief,input)=>{calls.push(['delegate',projectId,input]);if(delegateResult instanceof Error)throw delegateResult;return delegateResult;},
 messageWorker:async(...a)=>{calls.push(['message',...a]);},
 stopWorker:async(...a)=>{calls.push(['stop',...a]);},
 messageChief:async(projectId,content,messageId,prepare)=>{calls.push(['chief',projectId,content,messageId]);await prepare?.({sessionId:'chief-'+projectId,workspaceId:'main-'+projectId});if(chiefError)throw chiefError;return {sessionId:'chief-'+projectId,workspaceId:'main-'+projectId,messageId,queued:chiefQueued};},
};
const load=Module._load;
Module._load=function(r,p,m){
 if(r==='server-only')return {};
 if(r==='@/lib/agent')return {getSession:(id)=>live.find(s=>s.id===id),listLiveSessions:()=>live};
 if(r==='../server')return {db:()=>null};
 if(r==='@/lib/notifications/service')return {notify:async(n)=>{notified.push(n);},resolveBySubject:async(k)=>{resolved.push(k);}};
 if(r==='@/lib/notifications/brief')return {runWithClaude:async()=>{if(routingResult)return routingResult;throw Error('No real model in tests');}};
 if(r==='@/lib/home/service')return {routeTargets:async()=>[{projectId:'p',name:'Project',slug:'project',workspaces:[]},{projectId:'q',name:'Other',slug:'other',workspaces:[]},{projectId:'home',name:'Home',slug:'home',workspaces:[]}],projectsOverview:async()=>[],ensureHomeProject:async()=>({id:'home',dataKey:'home'}),saveRoutingRule:async(t)=>{calls.push(['rule',t]);}};
 if(r==='@/lib/projects/memory')return {readMemory:async()=>''};
 if(r==='@/lib/db/repo/messages')return {loadEvents:async()=>savedEvents};
 if(r==='@/lib/db/repo/workspaces')return {updateWorkspace:async(...a)=>{calls.push(['workspace',...a]);}};
 if(r==='@/lib/tasks/service')return {patchTask:async(id,patch)=>{calls.push(['patchTask',id,patch]);},createTask:async(input)=>{const t={id:'t1',...input};tasks.set(t.id,t);return t;}};
 if(r==='@/lib/db/repo/tasks')return {getTask:async(id)=>tasks.get(id)??null,updateTask:async(id,patch)=>{calls.push(['updateTask',id,patch]);}};
 if(r==='@/lib/db/repo/projects')return {getProject:async(id)=>({id})};
 if(r==='@/lib/db/repo/worker-state')return {isQueued:async(id)=>queue.some(q=>q.taskId===id),listQueue:async()=>queue,relayTaskIds:async(id)=>[...new Set(Object.values(relayTasks[id]??{}))],racesForTask:async()=>[]};
 if(r==='@/lib/db/repo/delegation-plans')return {hasPendingPlanForRelay:async(id)=>Object.values(plans).some(p=>p.relayId===id&&p.status==='pending')};
 if(r==='@/lib/workers/report-up')return {savedReports:async(_project,id)=>reports[id]??[]};
 if(r==='@/lib/workers/service')return workers;
 if(r==='@/lib/projects/archive')return {archiveWorkspace:async(id)=>{calls.push(['archive',id]);}};
 return load.call(this,r,p,m);
};
const {routeCapture}=require('../lib/capture/router.ts');
const repo=require('../lib/db/repo/captures.ts');
const service=require('../lib/capture/service.ts');
const api=require('../app/api/captures/route.ts');
const actionApi=require('../app/api/captures/[id]/[action]/route.ts');
const retryApi=require('../app/api/captures/[id]/retry/route.ts');
const {chipLabel}=require('../lib/capture/chip.ts');
const {parseThread,appendTurn,lastReport}=require('../lib/capture/thread.ts');
// Left installed: the service loads workers, archive and notifications lazily with import().

const result=(projectId=null)=>JSON.stringify({projectId,mode:'worktree',title:'Try it',brief:'Build it',assumptions:['A guess']});
const row=(over={})=>({id:'c',text:'Look into it',status:'routing',project_id:null,task_id:null,workspace_id:null,session_id:null,mode:null,title:null,assumptions:[],next_step:null,summary:null,diff_stat:null,cost_usd:0,error:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...over});
const get=async(id='c')=>(await repo.listCaptures(true)).find(r=>r.id===id);
const post=(body)=>new Request('http://test/api/captures',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const params=(o)=>({params:Promise.resolve(o)});
const settle=()=>new Promise(r=>setTimeout(r,10));
beforeEach(()=>{reset();process.env.NEXT_PUBLIC_THUNK_E2E='1';});

test('unmatched routing uses a Home scout',async()=>{delete process.env.NEXT_PUBLIC_THUNK_E2E;const r=await routeCapture('look into this',undefined,async()=>result());assert.equal(r.projectId,'home');assert.equal(r.mode,'scout');});
test('project tags override model choice',async()=>{delete process.env.NEXT_PUBLIC_THUNK_E2E;const r=await routeCapture('fix #project',undefined,async()=>result());assert.equal(r.projectId,'p');});
test('invalid model output retries once',async()=>{delete process.env.NEXT_PUBLIC_THUNK_E2E;let calls=0;await assert.rejects(routeCapture('test',undefined,async()=>{calls++;return '{}';}));assert.equal(calls,2);});

test('worker lifecycle updates linked captures and excludes closed records',async()=>{await repo.saveCapture(row({task_id:'task',status:'queued'}),true);await repo.captureTask('task',{status:'working',session_id:'s'});assert.equal((await repo.listCaptures())[0].status,'working');await repo.captureTask('task',{status:'ready',summary:'Done'});assert.equal((await repo.listCaptures())[0].summary,'Done');await repo.captureTask('task',{status:'kept'});assert.equal((await repo.listCaptures()).length,0);assert.equal((await repo.listCaptures(true)).length,1);});
test('reaching ready raises one capture_ready notification',async()=>{await repo.saveCapture(row({task_id:'task',status:'working',project_id:'p'}),true);await repo.captureTask('task',{status:'ready',summary:'Done'});await repo.captureTask('task',{status:'ready',summary:'Done again'});assert.equal(notified.length,1);assert.equal(notified[0].kind,'capture_ready');assert.equal(notified[0].subjectKey,'capture:c');});

test('dispatch creates a task and delegates with first-pass rules',async()=>{await repo.saveCapture(row(),true);await service.dispatchCapture('c');const [, projectId,input]=calls.find(c=>c[0]==='delegate');assert.equal(projectId,'home');assert.equal(input.mode,'scout');assert.equal(input.taskId,'t1');assert.match(input.brief,/Do not push/);const r=await get();assert.equal(r.task_id,'t1');assert.equal(r.project_id,'home');});
test('a queued delegate leaves the capture queued',async()=>{delegateResult={taskId:'t1',queued:true};await repo.saveCapture(row(),true);await service.dispatchCapture('c');assert.equal((await get()).status,'queued');});
test('a failed dispatch marks the capture failed with the reason',async()=>{delegateResult=new Error('No repo');await repo.saveCapture(row(),true);await service.dispatchCapture('c');const r=await get();assert.equal(r.status,'failed');assert.equal(r.error,'No repo');});
test('restart: routing captures already linked to a running task are not dispatched twice',async()=>{tasks.set('t1',{id:'t1',status:'in_progress',sessionId:'s1',workspaceId:'w1'});await repo.saveCapture(row({task_id:'t1',project_id:'p'}),true);await service.recoverCaptures();await settle();assert.equal(calls.filter(c=>c[0]==='delegate').length,0);const r=await get();assert.equal(r.status,'working');assert.equal(r.session_id,'s1');});
test('restart: routing captures still in the worker queue become queued',async()=>{tasks.set('t1',{id:'t1',status:'todo'});queue=[{taskId:'t1'}];await repo.saveCapture(row({task_id:'t1',project_id:'p'}),true);await service.recoverCaptures();await settle();assert.equal((await get()).status,'queued');});
test('restart: unlinked routing captures are routed again',async()=>{await repo.saveCapture(row(),true);await service.recoverCaptures();await settle();assert.equal(calls.filter(c=>c[0]==='delegate').length,1);});

test('POST /api/captures validates, creates and enforces the open limit',async()=>{assert.equal((await api.POST(post({}))).status,400);assert.equal((await api.POST(post({text:'   '}))).status,400);const created=await api.POST(post({text:'Look into flaky checks'}));assert.equal(created.status,201);assert.equal((await created.json()).status,'routing');await settle();for(let i=1;i<8;i++)await repo.saveCapture(row({id:`c${i}`,status:'working'}),true);const full=await api.POST(post({text:'One more'}));assert.equal(full.status,400);assert.match((await full.json()).error,/Too many open thoughts/);});
test('GET /api/captures lists open captures with the limit and project names',async()=>{await repo.saveCapture(row({status:'working',project_id:'p'}),true);await repo.saveCapture(row({id:'k',status:'kept'}),true);const data=await (await api.GET()).json();assert.deepEqual(data.captures.map(c=>c.id),['c']);assert.equal(data.limit,8);assert.equal(data.names.p,'Project');});
test('continue sends the held-back step to the worker',async()=>{await repo.saveCapture(row({status:'ready',project_id:'p',task_id:'t1',session_id:'s1',next_step:'Open a PR'}),true);const r=await actionApi.POST(post({}),params({id:'c',action:'continue'}));assert.equal(r.status,200);const msg=calls.find(c=>c[0]==='message');assert.deepEqual(msg.slice(1,3),['p','t1']);assert.match(msg[3],/Open a PR/);assert.equal((await get()).status,'working');assert.deepEqual(resolved,['capture:c']);});
test('continue is refused before the capture is ready',async()=>{await repo.saveCapture(row({status:'working',project_id:'p',task_id:'t1',session_id:'s1'}),true);const r=await actionApi.POST(post({}),params({id:'c',action:'continue'}));assert.equal(r.status,400);assert.equal(calls.filter(c=>c[0]==='message').length,0);});
test('discard stops the worker, archives a worktree and restore brings it back',async()=>{tasks.set('t1',{id:'t1',sessionId:'s1'});await repo.saveCapture(row({status:'ready',project_id:'p',task_id:'t1',session_id:'s1',workspace_id:'w1',mode:'worktree',summary:'Did it'}),true);assert.equal((await actionApi.POST(post({}),params({id:'c',action:'discard'}))).status,200);assert.equal((await get()).status,'discarded');assert.ok(calls.some(c=>c[0]==='stop'));assert.ok(calls.some(c=>c[0]==='archive'&&c[1]==='w1'));assert.equal((await actionApi.POST(post({}),params({id:'c',action:'restore'}))).status,200);assert.equal((await get()).status,'ready');assert.ok(calls.some(c=>c[0]==='workspace'&&c[1]==='w1'));assert.equal(notified.at(-1).subjectKey,'capture:c','undo puts the thought back in the feed');});
test('discard never archives a shared scout workspace',async()=>{tasks.set('t1',{id:'t1',sessionId:'s1'});await repo.saveCapture(row({status:'ready',project_id:'p',task_id:'t1',session_id:'s1',workspace_id:'main',mode:'scout'}),true);await actionApi.POST(post({}),params({id:'c',action:'discard'}));assert.equal(calls.filter(c=>c[0]==='archive').length,0);});
test('a redirect naming another project re-routes there',async()=>{await repo.saveCapture(row({status:'ready',project_id:'p',task_id:'t1',session_id:'s1',workspace_id:'w1',mode:'worktree'}),true);await actionApi.POST(post({text:'Do this in #other'}),params({id:'c',action:'redirect'}));await settle();assert.ok(calls.some(c=>c[0]==='stop'));const d=calls.find(c=>c[0]==='chief');assert.equal(d[1],'q');assert.equal((await get()).session_id,'chief-q');assert.match((await get()).text,/Redirect: Do this in #other/);});
test('retry only accepts failed captures and known projects',async()=>{await repo.saveCapture(row({status:'working'}),true);assert.equal((await retryApi.POST(post({}),params({id:'c'}))).status,400);await repo.saveCapture(row({status:'failed'}));assert.equal((await retryApi.POST(post({projectId:'nope'}),params({id:'c'}))).status,400);assert.equal((await retryApi.POST(post({projectId:'p'}),params({id:'c'}))).status,202);await settle();assert.equal(calls.find(c=>c[0]==='chief')[1],'p');});

test('the sent chip follows the capture to its worker',()=>{const names={p:'Project'};assert.equal(chipLabel(row(),names),'Routing…');assert.equal(chipLabel(row({status:'queued',project_id:'p'}),names),'Queued in Project');assert.equal(chipLabel(row({status:'working',project_id:'p'}),names),'Working in Project');assert.equal(chipLabel(row({status:'working',project_id:'x'}),names),'Working in Home');assert.match(chipLabel(row({status:'failed'}),names),/Inbox/);assert.equal(chipLabel(undefined,names),null);});


test('a thought that matches a project goes to its chief with the original wording and assumptions', async () => {
 delete process.env.NEXT_PUBLIC_THUNK_E2E;
 routingResult=result('p');
 const original='Onboarding was confusing again.\nNeed something before next week, not a full rebuild.';
 await repo.saveCapture(row({text:original}),true);
 await service.dispatchCapture('c');
 assert.equal(calls.filter(c=>c[0]==='delegate').length,0);
 const [, projectId, message]=calls.find(c=>c[0]==='chief');
 assert.equal(projectId,'p');
 assert.match(message,/^<relay id="c">/);
 assert.ok(message.includes(original) && message.includes('Build it') && message.includes('A guess'));
 const r=await get();
 assert.equal(r.status,'working');assert.equal(r.task_id,null);assert.equal(r.session_id,'chief-p');assert.equal(r.workspace_id,'main-p');
 assert.deepEqual(r.assumptions,['A guess']);
});

test('the chief settles a relay with relay_report, and decisions go back to the chief', async () => {
 await repo.saveCapture(row({status:'working',project_id:'p',session_id:'chief-p',workspace_id:'main-p'}),true);
 await assert.rejects(service.reportRelay('q','c','done','Wrong project'),/No relay/);
 await service.reportRelay('p','c','done','Drafted the plan','Open a PR');
 let r=await get();
 assert.equal(r.status,'ready');assert.equal(r.summary,'Drafted the plan');assert.equal(r.next_step,'Open a PR');
 assert.equal(notified.at(-1).subjectKey,'capture:c');
 assert.equal((await actionApi.POST(post({}),params({id:'c',action:'continue'}))).status,200);
 assert.match(calls.at(-1)[2],/<relay_decision id="c" action="go_ahead">\nGo ahead with this step only: Open a PR/);
 assert.equal((await get()).status,'working');
 await service.reportRelay('p','c','blocked','Needs credentials');
 r=await get();assert.equal(r.next_step,null);
 // Replying is a chat turn: the chief gets the message, and the card keeps the whole exchange.
 await service.actOnCapture('c','redirect','Try the staging keys');
 assert.match(calls.at(-1)[2],/action="reply">\nTry the staging keys/);
 assert.equal((await get()).status,'working');
 await service.reportRelay('p','c','done','Staging keys worked');
 r=await get();
 assert.deepEqual(parseThread(r.summary),[{who:'chief',text:'Drafted the plan'},{who:'you',text:'Go ahead with this step only: Open a PR'},{who:'chief',text:'Blocked: Needs credentials'},{who:'you',text:'Try the staging keys'},{who:'chief',text:'Staging keys worked'}]);
 assert.equal(notified.at(-1).detail,'Staging keys worked');
 await service.actOnCapture('c','discard');
 assert.match(calls.at(-1)[2],/action="discard"/);
 assert.equal(calls.filter(c=>c[0]==='stop'||c[0]==='archive').length,0);
 assert.equal((await get()).status,'discarded');
});

test('a completed capture without a next step cannot trigger unspecified work', async () => {
 await repo.saveCapture(row({status:'ready',project_id:'p',task_id:'t1',session_id:'s1',summary:'Draft ready',next_step:null}),true);
 const response=await actionApi.POST(post({}),params({id:'c',action:'continue'}));
 assert.equal(response.status,400);
 assert.equal(calls.filter(c=>c[0]==='message').length,0);
 assert.equal((await get()).status,'ready');
 assert.deepEqual(resolved,[]);
 await service.actOnCapture('c','keep');
 assert.equal((await get()).status,'kept');
});

test('a relay the chief dropped becomes a failed thought, and a late report still settles it', async () => {
 const old=new Date(Date.now()-10*60_000).toISOString();
 const stale=()=>{globalThis.__captures.set('c',row({status:'working',project_id:'p',session_id:'chief-p',workspace_id:'main-p',updated_at:old}));};
 const session=(id,status,origin)=>({id,meta:{status,projectId:'p',origin},events:[]});
 // Not yet: the chief is mid-turn, a worker it started is running, or work is queued.
 stale();live=[session('chief-p','running',{kind:'chief'})];assert.equal(await service.sweepRelays(),0);
 relayTasks={c:{work:'t9'}};tasks.set('t9',{id:'t9',sessionId:'w',status:'in_progress'});live=[session('chief-p','idle',{kind:'chief'}),session('w','running',{kind:'worker'})];assert.equal(await service.sweepRelays(),0);
 live=[session('chief-p','idle',{kind:'chief'})];queue=[{taskId:'t9',input:{relayId:'c'}}];assert.equal(await service.sweepRelays(),0);
 // Recent relays are left alone even when everything is idle.
 queue=[];globalThis.__captures.set('c',row({status:'working',project_id:'p',session_id:'chief-p'}));assert.equal(await service.sweepRelays(),0);
 stale();assert.equal(await service.sweepRelays(),1);
 let r=await get();assert.equal(r.status,'failed');assert.match(r.error,/without reporting back/);
 // Worker-backed thoughts are never swept: the worker lifecycle settles them.
 globalThis.__captures.set('k',row({id:'k',status:'working',project_id:'p',task_id:'t1',session_id:'s1',updated_at:old}));assert.equal(await service.sweepRelays(),0);
 await service.reportRelay('p','c','done','Late, but here');
 r=await get();assert.equal(r.status,'ready');assert.equal(r.error,null);
});

test('a thread parses back into turns and tolerates a plain summary', () => {
 assert.deepEqual(parseThread(null),[]);
 assert.deepEqual(parseThread('Just a report'),[{who:'chief',text:'Just a report'}]);
 const thread=appendTurn(appendTurn(appendTurn(null,'chief','First'),'you','Why?'),'chief','Because.\n\nTwo paragraphs.');
 assert.deepEqual(parseThread(thread),[{who:'chief',text:'First'},{who:'you',text:'Why?'},{who:'chief',text:'Because.\n\nTwo paragraphs.'}]);
 assert.equal(lastReport(thread),'Because.\n\nTwo paragraphs.');
 assert.equal(lastReport(appendTurn(null,'you','Only me')),null);
});


test('queued replies keep their receipt and become working only after dequeue', async () => {
 await repo.saveCapture(row({status:'ready',project_id:'p',session_id:'chief-p',summary:'First answer'}),true);
 chiefQueued=true;
 await service.actOnCapture('c','redirect','Check the unfinished item');
 const queued=await get(); assert.equal(queued.status,'queued'); assert.ok(queued.message_id);
 assert.equal(calls.at(-1)[3],queued.message_id);
 const message={type:'user_message',messageId:queued.message_id,content:'Check it',queued:true,seq:1};
 live=[{id:'chief-p',meta:{status:'running'},events:[message]}];
 await service.sweepRelays(); assert.equal((await get()).status,'queued');
 await assert.rejects(service.reportRelay('p','c','done','An old answer'),/newer reply queued/);
 live[0].events.push({type:'message_dequeued',messageId:queued.message_id,seq:2});
 await service.sweepRelays(); assert.equal((await get()).status,'working');
 await service.reportRelay('p','c','done','Finished the item');
 assert.equal((await get()).status,'ready'); assert.equal(notified.at(-1).urgency,'info');
});

test('a stopped chief exposes its actual error immediately and keeps the conversation', async () => {
 await repo.saveCapture(row({status:'working',project_id:'p',session_id:'chief-p',message_id:'m',summary:'Existing answer'}),true);
 live=[{id:'chief-p',meta:{status:'error'},events:[{type:'user_message',messageId:'m',seq:1},{type:'error',seq:2,message:'Provider authentication expired'}]}];
 assert.equal(await service.sweepRelays(),1);
 assert.match((await get()).error,/Provider authentication expired/);
 assert.equal((await get()).summary,'Existing answer');
});

test('restart reconciles persisted queued receipts without dispatching the original request again', async () => {
 await repo.saveCapture(row({status:'queued',project_id:'p',session_id:'chief-p',message_id:'m'}),true);
 savedEvents=[{type:'user_message',messageId:'m',queued:true,seq:1}];
 await service.recoverCaptures();
 assert.equal((await get()).status,'failed'); assert.match((await get()).error,/server restarted/);
 assert.equal(calls.length,0);
});

test('resume preserves completed tasks, includes unfinished tasks and never routes or delegates again', async () => {
 await repo.saveCapture(row({status:'failed',project_id:'p',session_id:'chief-p',summary:appendTurn('Done A','you','Please finish B'),error:'Stopped'}),true);
 relayTasks={c:{a:'a',b:'b'}};
 tasks.set('a',{id:'a',title:'A',status:'done',sessionId:'sa'});tasks.set('b',{id:'b',title:'B',status:'blocked',sessionId:'sb'});
 chiefQueued=true;
 await Promise.allSettled([service.actOnCapture('c','resume'),service.actOnCapture('c','resume')]);
 assert.equal(calls.filter(c=>c[0]==='chief').length,1);
 assert.equal(calls.filter(c=>c[0]==='delegate').length,0);
 assert.match(calls[0][2],/a: A — done/);assert.match(calls[0][2],/b: B — blocked/);assert.match(calls[0][2],/Please finish B/);
 assert.equal((await get()).status,'queued');assert.equal(tasks.get('a').status,'done');
});

test('retrying an existing failed conversation resumes it instead of rerouting', async () => {
 await repo.saveCapture(row({status:'failed',project_id:'p',session_id:'chief-p',summary:'Already built A'}),true);
 await service.dispatchCapture('c');
 assert.match(calls[0][2],/^<relay_resume/);assert.equal(calls.filter(c=>c[0]==='delegate').length,0);
});

test('a failed reply delivery retains the reply for recovery', async () => {
 await repo.saveCapture(row({status:'ready',project_id:'p',session_id:'chief-p',summary:'First answer'}),true);
 chiefError=new Error('Provider unavailable');
 await assert.rejects(service.actOnCapture('c','redirect','Finish B'),/Provider unavailable/);
 const failed=await get();assert.equal(failed.status,'failed');assert.equal(parseThread(failed.summary).at(-1).text,'Finish B');
 assert.match(failed.error,/Reply was not delivered/);
});

test('work still in flight for a relay keeps it working past the grace period', async () => {
 const old=new Date(0).toISOString();
 const stale=()=>globalThis.__captures.set('c',row({status:'working',project_id:'p',session_id:'chief-p',updated_at:old}));
 // A finished worker whose report is still batched for the chief.
 stale();relayTasks={c:{work:'t9'}};tasks.set('t9',{id:'t9',sessionId:'w',status:'in_progress'});
 live=[{id:'chief-p',meta:{status:'idle'},events:[]},{id:'w',meta:{status:'idle'},events:[]}];
 reports={w:[{seq:1,delivered:false}]};assert.equal(await service.sweepRelays(),0);
 // A plan for this relay waiting on the person's approval.
 reports={w:[{seq:1,delivered:true}]};plans={x:{relayId:'c',status:'pending'}};assert.equal(await service.sweepRelays(),0);
 // A chief that errored while its worker still runs is resumed by the worker's report.
 plans={};live=[{id:'chief-p',meta:{status:'error'},events:[]},{id:'w',meta:{status:'running'},events:[]}];assert.equal(await service.sweepRelays(),0);
 assert.equal((await get()).status,'working');
 live=[{id:'chief-p',meta:{status:'idle'},events:[]},{id:'w',meta:{status:'idle'},events:[]}];assert.equal(await service.sweepRelays(),1);
});

test('unrelated project workers and queues do not conceal a stopped request', async () => {
 globalThis.__captures.set('c',row({status:'working',project_id:'p',session_id:'chief-p',updated_at:new Date(0).toISOString()}));
 live=[{id:'chief-p',meta:{status:'idle'},events:[]},{id:'other',meta:{status:'running'},events:[]}];
 queue=[{taskId:'other',input:{relayId:'different'}}];
 assert.equal(await service.sweepRelays(),1);
});

test('closing a conversation only files it and never approves its held-back action', async () => {
 await repo.saveCapture(row({status:'ready',project_id:'p',session_id:'chief-p',next_step:'Merge the PR'}),true);
 await service.actOnCapture('c','close');
 assert.equal((await get()).status,'kept');assert.equal(calls.length,0);assert.deepEqual(resolved,['capture:c']);
});


test('dispatch persists the chief destination even when sending fails', async () => {
 delete process.env.NEXT_PUBLIC_THUNK_E2E; routingResult=result('p'); chiefError=new Error('Connection lost before send');
 await repo.saveCapture(row(),true);await service.dispatchCapture('c');
 const failed=await get();assert.equal(failed.status,'failed');assert.equal(failed.session_id,'chief-p');assert.ok(failed.message_id);
 chiefError=null;await service.dispatchCapture('c');
 assert.match(calls.at(-1)[2],/^<relay_resume/);
});

test('a crash while preparing the chief cannot leave an unattached request queued forever', async () => {
 globalThis.__captures.set('c',row({status:'queued',project_id:'p',updated_at:new Date(0).toISOString()}));
 assert.equal(await service.sweepRelays(),1);assert.match((await get()).error,/before a chief session was attached/);
});
