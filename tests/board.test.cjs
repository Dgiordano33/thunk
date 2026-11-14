/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const ts=require('typescript');const Module=require('node:module');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(require('node:fs').readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const resolve=Module._resolveFilename;Module._resolveFilename=function(request,...rest){if(request.startsWith('@/'))request=path.join(__dirname,'..',request.slice(2)+'.ts');return resolve.call(this,request,...rest);};
const store=require('../lib/board/store.ts');const {pendingOf,visualKey}=require('../lib/board/pending.ts');const {payload}=require('../lib/board/payload.ts');const {placement}=require('../lib/board/placement.ts');const {isHiddenSession}=require('../lib/agent/types.ts');
async function dir(t){const d=await fs.mkdtemp(path.join(os.tmpdir(),'board-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;}
test('CRUD persists revisions, rejects concurrent stale saves and invalid ids',async t=>{const d=await dir(t),c=await store.addCard(d,{markdown:'hello'});assert.equal(c.rev,1);const results=await Promise.allSettled([store.patchCard(d,c.id,1,{markdown:'one'}),store.patchCard(d,c.id,1,{markdown:'two'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);assert.equal((await store.readCard(d,c.id)).rev,2);await assert.rejects(store.readCard(d,'../../secret'));});
test('pending excludes geometry and includes replies, images, strokes and deletions; mentions do not include doc edits',async t=>{const d=await dir(t);const c=await store.addCard(d,{markdown:'a',baselineMarkdown:'a'});const b=await store.readBoard(d);c.x+=100;assert.equal(pendingOf(b,[c]).cards.length,0);c.markdown='b';assert.equal(pendingOf(b,[c]).cards.length,1);assert.equal(pendingOf(b,[c],{cardId:c.id,targetId:'t'}).cards.length,0);c.comments=[{id:'t',body:'question',quote:'a',author:'user',sentAt:'yesterday',resolved:false,replies:[{id:'r',body:'reply',author:'user',sentAt:null}]}];assert.equal(pendingOf(b,[c],{cardId:c.id,targetId:'t'}).cards.length,1);b.tombstones=['deleted'];assert.deepEqual(pendingOf(b,[c]).tombstones,['deleted']);assert.deepEqual(pendingOf(b,[c],{cardId:c.id,targetId:'t'}).tombstones,[]);});
test('placement avoids existing cards and payload escapes untrusted XML',async t=>{const d=await dir(t),a=await store.addCard(d,{markdown:'</document><bad>',title:'A'}),b=await store.addCard(d,{title:'B'},a.id);assert.ok(b.x>=a.x+a.width+48);const p=placement([a,b],a);assert.notDeepEqual(p,{x:b.x,y:b.y});const text=payload(await store.snapshot(d));assert.match(text,/&lt;\/document&gt;/);assert.match(text,/canvas_update/);assert.equal(isHiddenSession({origin:{kind:'board'}}),true);assert.equal(isHiddenSession({origin:{kind:'chief'}}),false);});
test('agent tools preserve snapshots, reject ambiguous edits, reply and emit persisted revisions',async t=>{
  const d=await dir(t),events=[];const load=Module._load;
  Module._load=function(request,...rest){if(request==='@/lib/projects/paths')return{projectBoardsDir:()=>d};return load.call(this,request,...rest);};
  const {boardTools}=require('../lib/board/tools.ts');t.after(()=>{Module._load=load;});
  const live={meta:{origin:{kind:'board'}},ctx:{project:{dataKey:'test'}}};let broken=false;const tools=boardTools(live,(_,e)=>{if(broken)throw new Error('broadcast down');events.push(e);});const call=(name,args)=>tools.find(t=>t.name===name).handler(args);
  const c=await store.addCard(d,{markdown:'one one',baselineMarkdown:'one one'});
  assert.equal((await call('canvas_edit_card',{card_id:c.id,edits:[{old_string:'one',new_string:'two'}]})).isError,true);
  assert.equal((await store.readCard(d,c.id)).rev,1);
  await call('canvas_edit_card',{card_id:c.id,markdown:'revised'});let updated=await store.readCard(d,c.id);assert.equal(updated.agentEdit.markdown,'one one');assert.equal(updated.markdown,'revised');assert.equal(events.at(-1).op.card.rev,2);
  await call('canvas_comment',{card_id:c.id,quote:'missing',body:'question'});updated=await store.readCard(d,c.id);assert.equal(updated.comments[0].detached,true);
  await call('canvas_reply',{card_id:c.id,target_id:updated.comments[0].id,body:'answer',resolve:true});updated=await store.readCard(d,c.id);assert.equal(updated.comments[0].replies[0].body,'answer');assert.equal(updated.comments[0].resolved,true);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const added=JSON.parse((await call('canvas_add_image',{svg,title:'Chart',source_card_id:c.id,placement:'below'})).content[0].text);
  assert.equal(added.kind,'image');assert.equal(added.mime,'image/svg+xml');assert.equal(added.author,'agent');assert.ok(added.sentAt);assert.ok(added.y>=c.y+c.height);
  assert.equal(await fs.readFile(path.join(d,'assets',added.asset),'utf8'),svg);assert.equal(pendingOf(await store.readBoard(d),[added]).cards.length,0);
  assert.equal((await call('canvas_add_image',{svg,path:'/tmp/x.png'})).isError,true);assert.equal((await call('canvas_add_image',{path:'relative.png'})).isError,true);
  const rows=[{day:'Mon',ok:3,bad:1},{day:'Tue',ok:5,bad:null}];
  const chart=JSON.parse((await call('canvas_add_chart',{type:'line',title:'Runs',x:'day',series:[{key:'ok',label:'OK'},{key:'bad'}],rows,unit:'%',stats:[{label:'ignored',value:'1'}],source_card_id:c.id,placement:'below'})).content[0].text);
  assert.equal(chart.kind,'chart');assert.equal(chart.title,'Runs');assert.equal(chart.width,640);assert.deepEqual(chart.chart,{type:'line',x:'day',series:[{key:'ok',label:'OK'},{key:'bad'}],rows,unit:'%'});assert.equal(pendingOf(await store.readBoard(d),[chart]).cards.length,0);
  for(const bad of [{type:'line',title:'t',x:'day',series:[{key:'ok'}]},{type:'bar',title:'t',x:'day',series:[{key:'day'}],rows},{type:'bar',title:'t',x:'day',series:[{key:'ok'}],rows:[{day:'Mon',ok:'3'}]},{type:'line',title:'t',x:'day',series:[{key:'none'}],rows},{type:'stat',title:'t'},{type:'pie',title:'t'}])assert.equal((await call('canvas_add_chart',bad)).isError,true);
  const stat=JSON.parse((await call('canvas_add_chart',{type:'stat',title:'Totals',stats:[{label:'Runs',value:'347',detail:'up 62%'}]})).content[0].text);assert.deepEqual(stat.chart,{type:'stat',stats:[{label:'Runs',value:'347',detail:'up 62%'}]});assert.ok(stat.height<200);
  const edited=JSON.parse((await call('canvas_edit_chart',{card_id:chart.id,type:'bar',rows:[...rows,{day:'Wed',ok:8,bad:2}]})).content[0].text);assert.equal(edited.chart.type,'bar');assert.equal(edited.chart.rows.length,3);assert.equal(edited.chart.x,'day');assert.equal(edited.title,'Runs');assert.equal(edited.rev,chart.rev+1);
  assert.equal((await call('canvas_edit_chart',{card_id:chart.id,series:[{key:'gone'}]})).isError,true);assert.equal((await store.readCard(d,chart.id)).rev,edited.rev);assert.equal((await call('canvas_edit_chart',{card_id:c.id,rows})).isError,true);assert.equal((await call('canvas_edit_card',{card_id:chart.id,markdown:'x'})).isError,true);
  assert.match(payload(await store.snapshot(d),{focus:[chart.id]},{cards:[edited],seen:[],tombstones:[]}),/<chart title="Runs">\{"type":"bar"/);
  // A failed broadcast still reports the saved card, so the agent does not retry and duplicate it.
  broken=true;const before=(await store.snapshot(d)).cards.length,quiet=await call('canvas_add_card',{markdown:'once'});broken=false;
  assert.ok(!quiet.isError);assert.equal((await store.snapshot(d)).cards.length,before+1);
  assert.deepEqual(boardTools({meta:{origin:null}},()=>{}),[]);
});
test('send stamps only the dispatched scope, preserves baseline for mentions, and retains pending work on dispatch failure',async t=>{
 const d=await dir(t);let fail=false,content='';const live={id:'session',meta:{sdkSessionId:'sdk'},events:[]};const load=Module._load;
 Module._load=function(request,...rest){if(request==='@/lib/agent')return{resumeSession:async()=>live,startSession:async()=>live,subscribe:()=>{},emit:()=>{},pushUserMessage:(_,text)=>{if(fail)throw new Error('dispatch failed');content=text;}};if(request==='@/lib/projects')return{ensureMainWorkspace:async()=>({id:'main'})};if(request==='./service'&&rest[0]?.filename.endsWith('/board/session.ts'))return{boardFor:async()=>({project:{id:'p'},dir:d})};return load.call(this,request,...rest);};t.after(()=>{Module._load=load;});
 const {sendBoard}=require('../lib/board/session.ts');const c=await store.addCard(d,{markdown:'new',baselineMarkdown:'old',comments:[{id:'t',quote:'new',body:'question',author:'user',sentAt:null,resolved:false,replies:[]}]});
 await sendBoard('p',{cardId:c.id,targetId:'t'});let saved=await store.readCard(d,c.id);assert.equal(saved.baselineMarkdown,'old');assert.ok(saved.comments[0].sentAt);assert.match(content,/mode="mention"/);
 fail=true;await assert.rejects(sendBoard('p'),/dispatch failed/);assert.equal((await store.readCard(d,c.id)).baselineMarkdown,'old');
 fail=false;await sendBoard('p');saved=await store.readCard(d,c.id);assert.equal(saved.baselineMarkdown,'new');assert.equal(pendingOf(await store.readBoard(d),[saved]).cards.length,0);assert.equal((await store.readBoard(d)).agent.sdkSessionId,'sdk');
});
test('cluster flood-fills nearby rects; intersecting and focusIds combine anchor, rect and manual edits',()=>{
  const {cluster,intersecting,bounds,focusIds}=require('../lib/board/focus.ts');
  const cards=[{id:'a',x:0,y:0,width:900,height:100},{id:'b',x:0,y:150,width:900,height:100},{id:'c',x:0,y:300,width:200,height:50},{id:'far',x:3000,y:0,width:100,height:100}];
  assert.deepEqual(cluster(cards,'a'),['a','b','c']);
  assert.deepEqual(cluster(cards,'a',10),['a']);
  assert.deepEqual(cluster(cards,'missing'),[]);
  assert.deepEqual(intersecting(cards,{x:2900,y:-50,width:200,height:100}),['far']);
  assert.deepEqual(bounds(cards,['a','c']),{x:0,y:0,width:900,height:350});
  assert.equal(bounds(cards,[]),null);
  assert.deepEqual(focusIds(cards,{anchorId:'a',rect:{x:3050,y:0,width:10,height:10},add:[],remove:['b']}),['a','c','far']);
  assert.deepEqual(focusIds(cards,{anchorId:null,rect:null,add:['far'],remove:[]}),['far']);
});
test('extendDrawing grows the bbox and keeps existing strokes in place',()=>{
  const {extendDrawing,DRAWING_PAD}=require('../lib/board/drawing.ts');
  const first=extendDrawing({x:0,y:0,width:0,height:0,strokes:[]},[{x:100,y:100},{x:200,y:150}],'s1');
  assert.deepEqual([first.x,first.y,first.width,first.height],[100-DRAWING_PAD,100-DRAWING_PAD,100+2*DRAWING_PAD,50+2*DRAWING_PAD]);
  const world=(card,p)=>({x:card.x+p.x*card.width,y:card.y+p.y*card.height});
  const before=world(first,first.strokes[0].points[1]);
  const next=extendDrawing(first,[{x:400,y:20}],'s2');
  assert.equal(next.strokes.length,2);
  const after=world(next,next.strokes[0].points[1]);
  assert.ok(Math.abs(after.x-before.x)<1e-9&&Math.abs(after.y-before.y)<1e-9);
  assert.ok(next.strokes.flatMap(s=>s.points).every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));
  assert.equal(next.width,400+DRAWING_PAD-(100-DRAWING_PAD));
});
test('positioned create skips placement and doc width defaults to 900',async t=>{
  const d=await dir(t),a=await store.addCard(d,{markdown:'a'});assert.equal(a.width,900);
  const b=await store.addCard(d,{markdown:'b',x:a.x,y:a.y});assert.deepEqual([b.x,b.y],[a.x,a.y]);
  const img=await store.addCard(d,{kind:'image'});assert.equal(img.width,420);
});
test('deleting a never-sent card leaves no tombstone; deleting a sent card does',async t=>{
  const d=await dir(t);const load=Module._load;
  Module._load=function(request,...rest){if(request==='@/lib/agent')return{getSession:()=>null};if(request==='./service'&&rest[0]?.filename.endsWith('/board/routes.ts'))return{boardFor:async()=>({project:{id:'p'},dir:d}),addImageCard:async()=>{}};if(request==='./session'&&rest[0]?.filename.endsWith('/board/routes.ts'))return{sendBoard:async()=>({})};if(request==='./refresh'&&rest[0]?.filename.endsWith('/board/routes.ts'))return{refreshChart:async()=>({})};return load.call(this,request,...rest);};t.after(()=>{Module._load=load;});
  const {item}=require('../lib/board/routes.ts');
  const del=c=>item.DELETE(new Request('http://x',{method:'DELETE',body:JSON.stringify({baseRev:c.rev}),headers:{'content-type':'application/json'}}),{params:Promise.resolve({id:'p',cardId:c.id})});
  const fresh=await store.addCard(d,{});assert.equal((await del(fresh)).status,200);assert.deepEqual((await store.readBoard(d)).tombstones,[]);
  const sent=await store.addCard(d,{markdown:'x',baselineMarkdown:'x',sentAt:'now'});await del(sent);assert.deepEqual((await store.readBoard(d)).tombstones,[sent.id]);
});
test('focus scope returns every listed card in reading order and the focus payload carries layout without a diff',async t=>{
  const d=await dir(t);const low=await store.addCard(d,{markdown:'second',baselineMarkdown:'second',x:0,y:500});const high=await store.addCard(d,{markdown:'first',baselineMarkdown:'first',x:0,y:0});const right=await store.addCard(d,{markdown:'beside',baselineMarkdown:'',x:950,y:0});
  const drawing=await store.addCard(d,{kind:'drawing',x:0,y:900,width:100,height:80});await store.addCard(d,{markdown:'outside'});
  const state=await store.snapshot(d);const ids=[low.id,high.id,right.id,drawing.id];state.board.tombstones=['gone'];
  const pending=pendingOf(state.board,state.cards,{focus:ids});
  assert.deepEqual(pending.cards.map(c=>c.id),[right.id,drawing.id]);assert.deepEqual(pending.seen.map(c=>c.id),[high.id,low.id]);assert.deepEqual(pending.tombstones,[]);
  const text=payload(state,{focus:ids});assert.match(text,/mode="focus"/);assert.doesNotMatch(text,/@@/);assert.doesNotMatch(text,/outside/);
  assert.match(text,new RegExp(`id="${high.id}"[^>]*seen="true">first</card>`));assert.match(text,/<document>beside<\/document>/);assert.doesNotMatch(text,/<document>first/);
  assert.match(text,new RegExp(`source_card_id="${drawing.id}"`));assert.match(text,/x="0" y="500" width="900"/);assert.match(text,new RegExp(`<drawing>${drawing.id}.annotated.png</drawing>`));assert.doesNotMatch(text,/<deleted>/);
});
test('focus send stamps the group, attaches drawings and rejects more than five images',async t=>{
  const d=await dir(t);let message=null;const live={id:'session',meta:{sdkSessionId:'sdk'},events:[]};const load=Module._load;
  Module._load=function(request,...rest){if(request==='@/lib/agent')return{resumeSession:async()=>live,startSession:async()=>live,subscribe:()=>{},emit:()=>{},pushUserMessage:(_,text,opts)=>{message={text,opts};}};if(request==='@/lib/projects')return{ensureMainWorkspace:async()=>({id:'main'})};if(request==='./service'&&rest[0]?.filename.endsWith('/board/session.ts'))return{boardFor:async()=>({project:{id:'p'},dir:d})};return load.call(this,request,...rest);};t.after(()=>{Module._load=load;});
  delete require.cache[require.resolve('../lib/board/session.ts')];const {sendBoard}=require('../lib/board/session.ts');
  const empty=await store.addCard(d,{markdown:'  '});assert.equal((await sendBoard('p',{focus:[empty.id]})).sent,false);assert.equal(message,null);
  const doc=await store.addCard(d,{markdown:'plan',comments:[{id:'t',quote:'',body:'q',author:'user',sentAt:null,resolved:false,replies:[]}]});
  const drawing=await store.addCard(d,{kind:'drawing',width:50,height:50,strokes:[{id:'s',points:[{x:0,y:0}],sentAt:null}]});
  const png=Buffer.from('89504e470d0a1a0a00','hex');await store.atomic(path.join(d,'assets',`${drawing.id}.annotated.png`),png);await store.atomic(path.join(d,'assets',`${drawing.id}.annotated.key`),visualKey(drawing));
  await store.patchCard(d,drawing.id,0,{x:500});const moved=await store.readCard(d,drawing.id);assert.equal(moved.rev,drawing.rev+1);
  assert.equal((await sendBoard('p',{focus:[doc.id,drawing.id]})).sent,true);
  assert.match(message.text,/mode="focus"/);assert.equal(message.opts.images.length,1);assert.match(message.opts.images[0].url,/^data:image\/png;base64,/);
  const savedDoc=await store.readCard(d,doc.id),savedDrawing=await store.readCard(d,drawing.id);
  assert.equal(savedDoc.baselineMarkdown,'plan');assert.ok(savedDoc.sentAt);assert.ok(savedDoc.comments[0].sentAt);assert.ok(savedDrawing.sentAt);assert.ok(savedDrawing.strokes[0].sentAt);
  assert.equal(pendingOf(await store.readBoard(d),[savedDoc,savedDrawing]).cards.length,0);
  message=null;assert.equal((await sendBoard('p',{focus:[doc.id,drawing.id]})).sent,false);assert.equal(message,null);
  const follow=await store.addCard(d,{markdown:'and then?'});await sendBoard('p',{focus:[doc.id,drawing.id,follow.id]});
  assert.equal(message.opts.images.length,0);assert.match(message.text,/<document>and then\?<\/document>/);assert.doesNotMatch(message.text,/<document>plan/);
  // A typed instruction goes even when the group holds nothing new, and stays on the canvas as a chip under the group.
  message=null;const asked=await sendBoard('p',{focus:[doc.id,follow.id],prompt:' Why <this>? '});assert.equal(asked.sent,true);
  const chip=(await store.snapshot(d)).cards.find(c=>c.prompt);assert.equal(chip.markdown,'Why <this>?');assert.ok(chip.sentAt);assert.equal(chip.baselineMarkdown,chip.markdown);
  assert.match(message.text,/<instruction>Why &lt;this&gt;\?<\/instruction>/);assert.ok(message.text.includes(`source_card_id="${chip.id}"`));assert.doesNotMatch(message.text,/<document>/);
  assert.ok((await store.readBoard(d)).edges.some(e=>e.target===chip.id));assert.ok((await store.readBoard(d)).lastSend);
  assert.equal(pendingOf(await store.readBoard(d),[chip]).cards.length,0);
  const inked=await store.addCard(d,{kind:'drawing',width:50,height:50,strokes:[{id:'s2',points:[{x:0,y:0}],sentAt:null}]});
  await store.atomic(path.join(d,'assets',`${inked.id}.annotated.key`),visualKey({...inked,strokes:[]}));
  await assert.rejects(sendBoard('p',{focus:[inked.id]}),e=>e.status===409);assert.equal((await store.readCard(d,inked.id)).sentAt,null);
  const many=[];for(let i=0;i<6;i++)many.push((await store.addCard(d,{kind:'drawing',width:10,height:10})).id);
  await assert.rejects(sendBoard('p',{focus:many}),e=>e.status===400);
});
test('send all holds images over the per-turn cap instead of marking them sent',async t=>{
  const d=await dir(t);let message=null;const live={id:'session',meta:{sdkSessionId:'sdk'},events:[]};const load=Module._load;
  Module._load=function(request,...rest){if(request==='@/lib/agent')return{resumeSession:async()=>live,startSession:async()=>live,subscribe:()=>{},emit:()=>{},pushUserMessage:(_,text,opts)=>{message={text,opts};}};if(request==='@/lib/projects')return{ensureMainWorkspace:async()=>({id:'main'})};if(request==='./service'&&rest[0]?.filename.endsWith('/board/session.ts'))return{boardFor:async()=>({project:{id:'p'},dir:d})};return load.call(this,request,...rest);};t.after(()=>{Module._load=load;});
  delete require.cache[require.resolve('../lib/board/session.ts')];const {sendBoard}=require('../lib/board/session.ts');
  const png=Buffer.from('89504e470d0a1a0a00','hex');const ids=[];
  for(let i=0;i<7;i++){const c=await store.addCard(d,{kind:'drawing',x:0,y:i*100,width:10,height:10});ids.push(c.id);await store.atomic(path.join(d,'assets',`${c.id}.annotated.png`),png);await store.atomic(path.join(d,'assets',`${c.id}.annotated.key`),visualKey(c));}
  const result=await sendBoard('p');assert.equal(result.sent,true);assert.equal(result.held,2);assert.equal(message.opts.images.length,5);
  const after=await Promise.all(ids.map(id=>store.readCard(d,id)));assert.deepEqual(after.map(c=>!!c.sentAt),[true,true,true,true,true,false,false]);
});
test('agent cards stack under their source with estimated heights; geometry saves ignore stale revisions; client ids are honoured',async t=>{
  const d=await dir(t);const {stack}=require('../lib/board/layout.ts');const {estimateHeight}=require('../lib/board/placement.ts');
  const src=await store.addCard(d,{markdown:'prompt',x:0,y:0,height:100});
  const a=await store.addCard(d,{markdown:'# Title\n\nshort answer'},src.id,'below');assert.equal(a.below,src.id);assert.equal(a.y,148);assert.ok(a.height<200);
  const b=await store.addCard(d,{markdown:'| a | b |\n|---|---|\n| 1 | 2 |'},a.id,'below');assert.equal(b.below,a.id);assert.equal(b.y,a.y+a.height+48);
  assert.deepEqual(stack([{...src,height:300},a,b]),{[a.id]:{x:0,y:348},[b.id]:{x:0,y:348+a.height+48}});
  assert.deepEqual(stack([src,{...a,below:null,y:900},b]),{[b.id]:{x:0,y:900+a.height+48}});
  assert.ok(estimateHeight('x'.repeat(2000))>estimateHeight('x'));
  const blocker=await store.addCard(d,{markdown:'other',x:0,y:2000,height:100});const c=await store.addCard(d,{markdown:'beside'},blocker.id,'right');assert.equal(c.below,undefined);
  await store.patchCard(d,src.id,src.rev,{markdown:'edited'});await store.patchCard(d,src.id,src.rev,{height:120});assert.equal((await store.readCard(d,src.id)).height,120);
  await assert.rejects(store.patchCard(d,src.id,src.rev,{markdown:'stale'}),e=>e.status===409);
  const own=await store.addCard(d,{id:'draft-1',markdown:'typed'});assert.equal(own.id,'draft-1');await assert.rejects(store.addCard(d,{id:'draft-1'}),e=>e.status===409);
  const {imageAspect}=require('../lib/board/service.ts');assert.equal(imageAspect(Buffer.from('<svg xmlns="x" viewBox="0 0 200 100">'),'image/svg+xml'),.5);
});
test('a resized outline is exactly what sits inside it',()=>{
  const {focusIds}=require('../lib/board/focus.ts');
  const cards=[{id:'a',x:0,y:0,width:900,height:100},{id:'b',x:0,y:150,width:900,height:100},{id:'c',x:0,y:300,width:200,height:50}];
  assert.deepEqual(focusIds(cards,{anchorId:'a',rect:{x:-20,y:-20,width:940,height:240},add:[],remove:[],fixed:true}),['a','b']);
  assert.deepEqual(focusIds(cards,{anchorId:'a',rect:{x:-20,y:-20,width:940,height:240},add:[],remove:[],fixed:false}),['a','b','c']);
});
test('chart axis ticks are round, include zero and cover the data; values format with their unit',()=>{
  const {niceTicks,formatValue}=require('../lib/board/chart.ts');
  assert.deepEqual(niceTicks(12,55),[0,20,40,60]);assert.deepEqual(niceTicks(-3,7),[-5,-2.5,0,2.5,5,7.5]);assert.deepEqual(niceTicks(0,0),[0,0.25,0.5,0.75,1]);assert.deepEqual(niceTicks(0.1,0.9),[0,0.25,0.5,0.75,1]);
  assert.equal(formatValue(1234.5,'$'),'$1,234.5');assert.equal(formatValue(-2,'$'),'−$2');assert.equal(formatValue(85,'%'),'85%');assert.equal(formatValue(13,'min'),'13 min');assert.equal(formatValue(48200,'',true),'48.2K');
});
test('pie, scatter and stacked bar charts validate their shape',()=>{
  const {parseChart}=require('../lib/board/chart.ts');
  const pie=parseChart({type:'pie',x:'kind',series:[{key:'n'}],rows:[{kind:'api',n:3},{kind:'browser',n:0}],stacked:true});assert.equal(pie.type,'pie');assert.equal(pie.stacked,undefined);
  for(const bad of [{type:'pie',x:'k',series:[{key:'a'},{key:'b'}],rows:[{k:'x',a:1,b:2}]},{type:'pie',x:'k',series:[{key:'a'}],rows:[{k:'x',a:-1}]},{type:'pie',x:'k',series:[{key:'a'}],rows:[{k:'x',a:0}]},{type:'scatter',x:'size',series:[{key:'ms'}],rows:[{size:'big',ms:3}]},{type:'bar',x:'d',series:[{key:'a'}],rows:[{d:'Mon',a:1},{d:'Mon',a:2}]}])assert.throws(()=>parseChart(bad));
  const sc=parseChart({type:'scatter',x:'size',xLabel:'Size (KB)',series:[{key:'ms'}],rows:[{size:1,ms:3},{size:1,ms:4}]});assert.equal(sc.rows.length,2);assert.equal(sc.xLabel,'Size (KB)');
  assert.equal(parseChart({type:'bar',x:'d',series:[{key:'a'},{key:'b'}],rows:[{d:'Mon',a:1,b:2}],stacked:true}).stacked,true);
  assert.equal(parseChart({type:'bar',x:'d',series:[{key:'a'}],rows:[{d:'Mon',a:1}],stacked:true}).stacked,undefined);
});
test('refresh output replaces rows or stats and is validated',()=>{
  const {applyRefresh,anchorRow}=require('../lib/board/chart.ts');const spec={type:'line',x:'d',series:[{key:'a'}],rows:[{d:'Mon',a:1}]};
  assert.deepEqual(applyRefresh(spec,'[{"d":"Tue","a":2}]').rows,[{d:'Tue',a:2}]);
  assert.deepEqual(applyRefresh(spec,'fetching…\n{"rows":[{"d":"Wed","a":5}],"unit":"ignored"}').rows,[{d:'Wed',a:5}]);
  assert.deepEqual(applyRefresh({type:'stat',stats:[{label:'x',value:'1'}]},'[{"label":"Runs","value":"9"}]').stats,[{label:'Runs',value:'9'}]);
  assert.throws(()=>applyRefresh(spec,'not json'),/did not print JSON/);assert.throws(()=>applyRefresh(spec,'{"other":1}'),/without rows/);assert.throws(()=>applyRefresh(spec,'[{"d":"Tue","a":"two"}]'));
  assert.equal(anchorRow(spec,{x:'Mon'}),0);assert.equal(anchorRow(spec,{x:'Sun'}),-1);
  const sc={type:'scatter',x:'s',series:[{key:'a'}],rows:[{s:1,a:1},{s:1,a:2}]};assert.equal(anchorRow(sc,{x:1,row:1}),1);assert.equal(anchorRow(sc,{x:1,row:7}),0);
});
test('hand edits to chart rows are pending with a diff until sent; ink makes a chart visual',async t=>{
  const d=await dir(t),rows=[{d:'Mon',a:1},{d:'Tue',a:2}],chart={type:'bar',x:'d',series:[{key:'a'}],rows};
  const c=await store.addCard(d,{kind:'chart',chart,title:'Runs',author:'agent',sentAt:'earlier'});const b=await store.readBoard(d);
  assert.equal(pendingOf(b,[c]).cards.length,0);
  let saved=await store.patchCard(d,c.id,c.rev,{chart:{...chart,rows:[rows[0],{d:'Tue',a:7}]}});assert.deepEqual(saved.baselineChart,chart);assert.equal(pendingOf(b,[saved]).cards.length,1);
  const text=payload(await store.snapshot(d));assert.match(text,/user_data_edit/);assert.match(text,/-\{&quot;d&quot;:&quot;Tue&quot;,&quot;a&quot;:2\}|-\{"d":"Tue","a":2\}/);
  saved=await store.patchCard(d,c.id,saved.rev,{chart:{...chart,rows:[rows[0],{d:'Tue',a:9}]}});assert.deepEqual(saved.baselineChart,chart);
  saved=await store.patchCard(d,c.id,saved.rev,{chart});assert.equal(saved.baselineChart,undefined);assert.equal(pendingOf(b,[saved]).cards.length,0);
  const doc=await store.addCard(d,{markdown:'x'});await assert.rejects(store.patchCard(d,doc.id,doc.rev,{chart}),/Not a chart/);
  const {isVisual}=require('../lib/board/pending.ts');assert.equal(isVisual(saved),false);
  const inked={...saved,strokes:[{id:'s',points:[{x:.1,y:.1}],sentAt:null}]};assert.equal(isVisual(inked),true);assert.equal(pendingOf(b,[inked]).cards.length,1);
  assert.notEqual(visualKey(inked),visualKey({...inked,chart:{...chart,rows:[rows[0]]}}));
  assert.notEqual(visualKey(inked),visualKey({...inked,comments:[{id:'p',quote:'Mon',body:'here',anchor:{x:'Mon',series:'a'},author:'user',sentAt:null,resolved:false,replies:[]}]}));
  assert.match(payload({board:b,cards:[inked]}),/<drawing note="The user drew on this chart/);
});
test('chart refresh runs the confirmed command in the workspace and refuses a changed one',async t=>{
  const d=await dir(t),cwd=await dir(t);await fs.writeFile(path.join(cwd,'rows.json'),'[{"d":"Wed","a":4}]');const load=Module._load;
  Module._load=function(request,...rest){if(request==='@/lib/projects')return{ensureMainWorkspace:async()=>({id:'main',cwd})};return load.call(this,request,...rest);};t.after(()=>{Module._load=load;});
  const {refreshChart}=require('../lib/board/refresh.ts');
  const c=await store.addCard(d,{kind:'chart',chart:{type:'line',x:'d',series:[{key:'a'}],rows:[{d:'Mon',a:1}]},chartSource:{command:'cat rows.json'},title:'Runs',author:'agent',sentAt:'earlier'});
  await assert.rejects(refreshChart({},d,c.id,'rm -rf /'),/changed/);
  const done=await refreshChart({},d,c.id,'cat rows.json');assert.deepEqual(done.chart.rows,[{d:'Wed',a:4}]);assert.equal(done.chartSource.approved,true);assert.ok(done.chartSource.refreshedAt);
  await store.patchCard(d,c.id,done.rev,{});const bad=await store.readCard(d,c.id);bad.chartSource={command:'echo nope; exit 3'};await store.saveCard(d,bad);
  await assert.rejects(refreshChart({},d,c.id,'echo nope; exit 3'),e=>e.status===422);
  const doc=await store.addCard(d,{markdown:'x'});await assert.rejects(refreshChart({},d,doc.id,'true'),/no source/);
});
