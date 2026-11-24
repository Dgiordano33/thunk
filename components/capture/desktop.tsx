"use client";
import { useEffect, useState } from 'react';
import { CaptureInput } from './capture-input';
type Bridge = {settings:(value?:string)=>Promise<{shortcut:string}>;hide:()=>void};
const bridge=()=> (window as Window & {thunkCapture?:Bridge}).thunkCapture;
export function DesktopCapture(){useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')bridge()?.hide();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);return <main className="p-5"><CaptureInput onSent={()=>bridge()?.hide()}/></main>;}
export function CaptureShortcut(){const [value,setValue]=useState<string|null>(null);const [error,setError]=useState('');useEffect(()=>{void bridge()?.settings().then(r=>setValue(r.shortcut));},[]);if(value===null)return null;return <section className="p-4 space-y-2"><h2>Capture shortcut</h2><p className="text-sm">OS-wide shortcut on this computer. Leave blank to disable.</p><form onSubmit={async e=>{e.preventDefault();try{await bridge()?.settings(value);setError('Saved');}catch(e){setError((e as Error).message);}}}><input aria-label="Capture shortcut" className="border rounded p-2" value={value} onChange={e=>setValue(e.target.value)}/><button className="border rounded p-2">Save shortcut</button></form><p role="status">{error}</p></section>;}
