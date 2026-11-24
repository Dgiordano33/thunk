import { createCapture, captureLimit } from '@/lib/capture/service';
import { listCaptures } from '@/lib/db/repo/captures';
export async function GET() { return Response.json({captures:await listCaptures(),limit:await captureLimit()}); }
export async function POST(req: Request) { try { const body=await req.json(); if(typeof body.text!=='string') throw new Error('Text is required'); return Response.json(await createCapture(body.text),{status:201}); } catch(e) {return Response.json({error:(e as Error).message},{status:400});} }
