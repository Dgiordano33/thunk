import { dispatchCapture } from '@/lib/capture/service';
import { listCaptures } from '@/lib/db/repo/captures';
import { routeTargets } from '@/lib/home/service';
export async function POST(req: Request, ctx: {params:Promise<{id:string}>}) {
 try {
 const {id}=await ctx.params; const body=await req.json();
 const row=(await listCaptures()).find(r=>r.id===id);
 if(!row || row.status!=='failed')throw new Error('Only failed thoughts can be retried');
 if(body.projectId!==undefined && (typeof body.projectId!=='string' || !(await routeTargets()).some(p=>p.projectId===body.projectId)))throw new Error('Project not found');
 void dispatchCapture(id,body.projectId);return Response.json({ok:true},{status:202});
 } catch(e){return Response.json({error:(e as Error).message},{status:400});}
}
