"use client";
import { useEffect, useState } from 'react';
export function CaptureInput({disabled=false,onSent}: {disabled?:boolean;onSent?:()=>void}) {
 const [text,setText]=useState('');
 useEffect(()=>{setText(sessionStorage.getItem('capture-draft')||'');},[]);
 const change=(value:string)=>{setText(value);sessionStorage.setItem('capture-draft',value);}; const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 return <form onSubmit={async e=>{e.preventDefault();if(busy||disabled||!text.trim())return;setBusy(true);setError('');try{const r=await fetch('/api/captures',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});if(!r.ok)throw new Error((await r.json()).error);change('');onSent?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
 <div className="flex gap-2"><input aria-label="Capture a thought" autoFocus className="w-full rounded border bg-background p-3 text-sm" placeholder={disabled?'Too many open thoughts':'One thought. I’ll take a first crack…'} maxLength={10000} value={text} disabled={disabled||busy} onChange={e=>change(e.target.value)}/><button disabled={disabled||busy||!text.trim()} className="rounded border px-3 text-sm">{busy?'Sending…':'Capture'}</button></div>{error&&<p role="alert" className="text-destructive text-sm">{error}</p>}
 </form>;
}
