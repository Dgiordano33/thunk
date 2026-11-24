import { createCapture, captureLimit } from '@/lib/capture/service';
import { listCaptures } from '@/lib/db/repo/captures';
import { routeTargets } from '@/lib/home/service';
export async function GET() {
 const names = Object.fromEntries((await routeTargets()).map(t => [t.projectId, t.name]));
 return Response.json({captures:await listCaptures(),limit:await captureLimit(),names});
}
export async function POST(req: Request) { try { const body=await req.json(); if(typeof body.text!=='string') throw new Error('Text is required'); return Response.json(await createCapture(body.text),{status:201}); } catch(e) {return Response.json({error:(e as Error).message},{status:400});} }
