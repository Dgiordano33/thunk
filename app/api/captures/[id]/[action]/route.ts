import { actOnCapture } from '@/lib/capture/service';
export async function POST(req: Request, ctx:{params:Promise<{id:string;action:string}>}) {
 try {const {id,action}=await ctx.params;const body=await req.json();await actOnCapture(id,action,body.text);return Response.json({ok:true});}catch(e){return Response.json({error:(e as Error).message},{status:400});}
}
