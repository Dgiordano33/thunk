import { handle } from "@/lib/api/http";
import { serverInfo } from "@/lib/server/info";

export const dynamic = "force-dynamic";

/** What Settings → Help shows about this server: build, host and database. */
export const GET = handle(async () => Response.json(serverInfo()));
