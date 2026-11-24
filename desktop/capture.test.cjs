const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('capture shortcut handles collisions, validates IPC and unregisters on quit',()=>{
 const handlers={};const events={};const keys=new Map();let saved;
 const contents={mainFrame:{url:'http://localhost:3000/settings'}};
 let login=false;const created=[];
 const app={getPath:()=>'/tmp',on:(name,fn)=>events[name]=fn,getLoginItemSettings:()=>({openAtLogin:login}),setLoginItemSettings:o=>{login=o.openAtLogin;}};
 class Win{constructor(o){this.options=o;this.handlers={};this.visible=false;this.webContents={setWindowOpenHandler(){},on(){},send(){}};created.push(this);}
  setAlwaysOnTop(){}setVisibleOnAllWorkspaces(...a){this.allSpaces=a;}on(n,f){this.handlers[n]=f;}async loadURL(u){this.url=u;}isDestroyed(){return false;}isVisible(){return this.visible;}
  show(){this.visible=true;}hide(){this.visible=false;}focus(){}setBounds(b){this.bounds=b;}static getFocusedWindow(){return null;}}
 const electron={BrowserWindow:Win,screen:{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1600,height:900}})},globalShortcut:{register:(key,fn)=>{if(key==='Alt+Space')return false;keys.set(key,fn);return true;},unregister:key=>keys.delete(key),isRegistered:key=>keys.has(key),unregisterAll:()=>keys.clear()},ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>handlers[name]=fn}};
 const sandbox={module:{exports:{}},__dirname,console,URL,process,require:name=>name==='electron'?electron:name==='node:fs'?{readFileSync:()=>{throw Error('missing');},writeFileSync:(_,text)=>saved=text}:require(name)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'capture.cjs'),'utf8'),sandbox);
 sandbox.module.exports.installCapture({app,backend:{url:'http://localhost:3000'},mainWindow:()=>({webContents:contents})});
 const event={sender:contents,senderFrame:contents.mainFrame};
 assert.deepEqual({...handlers['capture:settings'](event)},{shortcut:'',unavailable:'Alt+Space',openAtLogin:process.platform==='linux'?null:false});
 assert.equal(handlers['capture:settings'](event,'Control+Shift+Space').shortcut,'Control+Shift+Space');
 assert.equal(JSON.parse(saved).shortcut,'Control+Shift+Space');
 assert.equal(handlers['capture:settings'](event).unavailable,'');
 // Choosing a shortcut preloads the window; on a Mac it is a panel that floats over full-screen apps.
 assert.equal(created.length,1);assert.match(created[0].url,/\/capture$/);
 if(process.platform==='darwin'){assert.equal(created[0].options.type,'panel');assert.equal(created[0].allSpaces[1].visibleOnFullScreen,true);}
 if(process.platform!=='linux'){assert.equal(handlers['capture:settings'](event,undefined,{openAtLogin:true}).openAtLogin,true);assert.equal(login,true);}
 assert.throws(()=>handlers['capture:settings'](event,'Alt+Space'),/already uses that shortcut/);
 assert.ok(keys.has('Control+Shift+Space'));assert.equal(handlers['capture:settings'](event).shortcut,'Control+Shift+Space');
 assert.throws(()=>handlers['capture:settings']({sender:{},senderFrame:{url:'https://evil.example'}}),/Not allowed/);
 assert.equal(keys.size,1);events['will-quit']();assert.equal(keys.size,0);
});
