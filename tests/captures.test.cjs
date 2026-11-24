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
let calls, tasks, queue, delegateResult, notified, resolved, routingResult;
const reset=()=>{routingResult=null;calls=[];tasks=new Map();queue=[];delegateResult={taskId:'t1'};notified=[];resolved=[];globalThis.__captures?.clear();};
reset();
const workers={
 delegate:async(projectId,chief,input)=>{calls.push(['delegate',projectId,input]);if(delegateResult instanceof Error)throw delegateResult;return delegateResult;},
 messageWorker:async(...a)=>{calls.push(['message',...a]);},
 stopWorker:async(...a)=>{calls.push(['stop',...a]);},
};
const load=Module._load;
Module._load=function(r,p,m){
 if(r==='server-only')return {};
 if(r==='../server')return {db:()=>null};
 if(r==='@/lib/notifications/service')return {notify:async(n)=>{notified.push(n);},resolveBySubject:async(k)=>{resolved.push(k);}};
 if(r==='@/lib/notifications/brief')return {runWithClaude:async()=>{if(routingResult)return routingResult;throw Error('No real model in tests');}};
 if(r==='@/lib/home/service')return {routeTargets:async()=>[{projectId:'p',name:'Project',slug:'project',workspaces:[]},{projectId:'q',name:'Other',slug:'other',workspaces:[]},{projectId:'home',name:'Home',slug:'home',workspaces:[]}],projectsOverview:async()=>[],ensureHomeProject:async()=>({id:'home',dataKey:'home'}),saveRoutingRule:async(t)=>{calls.push(['rule',t]);}};
 if(r==='@/lib/projects/memory')return {readMemory:async()=>''};
 if(r==='@/lib/notes/file-write')return {withFileLock:(_k,fn)=>fn()};
 if(r==='@/lib/db/repo/workspaces')return {updateWorkspace:async(...a)=>{calls.push(['workspace',...a]);}};
 if(r==='@/lib/tasks/service')return {patchTask:async(id,patch)=>{calls.push(['patchTask',id,patch]);},createTask:async(input)=>{const t={id:'t1',...input};tasks.set(t.id,t);return t;}};
 if(r==='@/lib/db/repo/tasks')return {getTask:async(id)=>tasks.get(id)??null,updateTask:async(id,patch)=>{calls.push(['updateTask',id,patch]);}};
 if(r==='@/lib/db/repo/projects')return {getProject:async(id)=>({id})};
 if(r==='@/lib/workers/state')return {readWorkerState:async()=>({queue})};
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

test('dispatch creates a task and delegates with first-crack rules',async()=>{await repo.saveCapture(row(),true);await service.dispatchCapture('c');const [, projectId,input]=calls.find(c=>c[0]==='delegate');assert.equal(projectId,'home');assert.equal(input.mode,'scout');assert.equal(input.taskId,'t1');assert.match(input.brief,/Do not push/);const r=await get();assert.equal(r.task_id,'t1');assert.equal(r.project_id,'home');});
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
test('a redirect naming another project re-routes there',async()=>{await repo.saveCapture(row({status:'ready',project_id:'p',task_id:'t1',session_id:'s1',workspace_id:'w1',mode:'worktree'}),true);await actionApi.POST(post({text:'Do this in #other'}),params({id:'c',action:'redirect'}));await settle();assert.ok(calls.some(c=>c[0]==='stop'));const d=calls.find(c=>c[0]==='delegate');assert.equal(d[1],'q');assert.match((await get()).text,/Redirect: Do this in #other/);});
test('retry only accepts failed captures and known projects',async()=>{await repo.saveCapture(row({status:'working'}),true);assert.equal((await retryApi.POST(post({}),params({id:'c'}))).status,400);await repo.saveCapture(row({status:'failed'}));assert.equal((await retryApi.POST(post({projectId:'nope'}),params({id:'c'}))).status,400);assert.equal((await retryApi.POST(post({projectId:'p'}),params({id:'c'}))).status,202);await settle();assert.equal(calls.find(c=>c[0]==='delegate')[1],'p');});

test('the sent chip follows the capture to its worker',()=>{const names={p:'Project'};assert.equal(chipLabel(row(),names),'Routing…');assert.equal(chipLabel(row({status:'queued',project_id:'p'}),names),'Queued in Project');assert.equal(chipLabel(row({status:'working',project_id:'p'}),names),'Working in Project');assert.equal(chipLabel(row({status:'working',project_id:'x'}),names),'Working in Home');assert.match(chipLabel(row({status:'failed'}),names),/Inbox/);assert.equal(chipLabel(undefined,names),null);});


test('dispatch preserves original wording and routing assumptions in the task and worker handoff', async () => {
 delete process.env.NEXT_PUBLIC_THUNK_E2E;
 routingResult=result('p');
 const original='Onboarding was confusing again.\nNeed something before next week, not a full rebuild.';
 await repo.saveCapture(row({text:original}),true);
 await service.dispatchCapture('c');
 const input=calls.find(c=>c[0]==='delegate')[2];
 assert.ok(input.brief.includes(original));
 assert.ok(input.brief.includes('Build it'));
 assert.ok(input.brief.includes('A guess'));
 assert.equal(tasks.get(input.taskId).body,input.brief);
 assert.deepEqual((await get()).assumptions,['A guess']);
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
