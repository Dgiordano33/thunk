import "server-only";
import { z } from 'zod';
import { runWithClaude, type BriefRunner } from '@/lib/notifications/brief';
import { projectsOverview, routeTargets, ensureHomeProject } from '@/lib/home/service';
import { parseRoutingItems } from '@/lib/home/routing';
import { readMemory } from '@/lib/projects/memory';
import { projectMemoryFile } from '@/lib/projects/paths';
export const RouteSchema = z.object({ projectId: z.string().nullable(), mode: z.enum(['scout','worktree']), title: z.string().min(1).max(200), brief: z.string().min(1), assumptions: z.array(z.string()) });
export async function routeCapture(text: string, override?: string, runner: BriefRunner = (prompt, signal) => runWithClaude(prompt, signal, "You route capture thoughts. Return only the requested JSON object.")) {
 const targets = await routeTargets();
 const pinned = override || parseRoutingItems('- [ ] '+text.replace(/\n/g,' '), targets)[0]?.target?.projectId;
 if (override && !targets.some(t => t.projectId === override)) throw new Error('Project not found');
 const home = await ensureHomeProject();
 const prompt = `Return only JSON {projectId: string|null, mode: "scout"|"worktree", title, brief, assumptions: string[]}. Route this thought to one project. Default to scout for research, plans or ambiguity; worktree only for explicit changes. No match means null and scout. Explain guesses in assumptions. The brief must stand alone. Pinned project: ${pinned ?? 'none'}. Projects: ${JSON.stringify(await projectsOverview())}. Routing memory: ${await readMemory(projectMemoryFile(home.dataKey))}. Thought: ${text}`;
 for (let attempt=0; ; attempt++) {
  try {
   const signal = AbortSignal.timeout(45000);
   const raw = process.env.NEXT_PUBLIC_THUNK_E2E === '1' ? JSON.stringify({projectId:null,mode:'scout',title:text.slice(0,100),brief:text,assumptions:[]}) : await Promise.race([runner(prompt,signal), new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Routing timed out')), {once:true}))]);
   const route = RouteSchema.parse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')));
   route.projectId = pinned ?? route.projectId;
   if (route.projectId === home.id) route.projectId = null;
   if (route.projectId && !targets.some(t=>t.projectId===route.projectId)) throw new Error('Unknown routing project');
   if (!route.projectId) { route.projectId=home.id; route.mode='scout'; }
   return route;
  } catch(e) { if(attempt) throw e; }
 }
}
