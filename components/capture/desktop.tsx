"use client";
import { useEffect } from 'react';
import { CaptureInput } from './capture-input';
type Bridge = {hide:()=>void};
const bridge=()=> (window as Window & {thunkCapture?:Bridge}).thunkCapture;
export function DesktopCapture(){useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')bridge()?.hide();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);return <main className="p-5"><CaptureInput onSent={()=>bridge()?.hide()}/></main>;}
