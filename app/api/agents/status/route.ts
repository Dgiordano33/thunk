import { handle } from "@/lib/api/http";
import { agentStatus } from "@/lib/agent/status";
export const dynamic = "force-dynamic";
export const GET = handle(async (request) => Response.json(await agentStatus(new URL(request.url).searchParams.has("refresh"))));
