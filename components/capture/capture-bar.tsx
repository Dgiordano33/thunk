"use client";
import { usePathname } from 'next/navigation';
import { useEffect,useState } from 'react';
import { CaptureInput } from './capture-input';
import { Dialog,DialogContent,DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
export function CaptureBar(){const pathname=usePathname();const [open,setOpen]=useState(false);useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='k'){e.preventDefault();setOpen(v=>!v);}};window.addEventListener('keydown',key);const show=()=>setOpen(true);window.addEventListener('thunk:capture',show);return()=>{window.removeEventListener('keydown',key);window.removeEventListener('thunk:capture',show);};},[]);if(pathname==='/capture')return null;return <><button aria-label="Capture a thought" className="fixed bottom-20 md:bottom-5 right-5 z-40 rounded-full border bg-background px-4 py-2 text-sm shadow" onClick={()=>setOpen(true)}>Capture</button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Take a first crack</DialogTitle><CaptureInput onSent={()=>{setOpen(false);toast('Thought captured. Routing…');}}/></DialogContent></Dialog></>;}
