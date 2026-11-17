import { handle, parseBody } from "@/lib/api/http";
import { readTriage, runTriage, saveTriage, TriageInput } from "@/lib/home/triage";

export const dynamic = "force-dynamic";

/** The daily triage of top-level notes: when it runs and what it did last. */
export const GET = handle(async () => Response.json({ triage: await readTriage() }));
export const PUT = handle(async (req: Request) => Response.json({ triage: await saveTriage(await parseBody(req, TriageInput)) }));
/** Run triage now. */
export const POST = handle(async () => Response.json({ ...(await runTriage("manual")), triage: await readTriage() }));
