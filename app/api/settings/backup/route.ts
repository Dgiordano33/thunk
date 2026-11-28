import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { BackupInput, backupStatus, runBackup, saveBackupSettings } from "@/lib/backup/service";

export const dynamic = "force-dynamic";

/** The daily backup of the data dir and database: its settings and the archives on disk. */
export const GET = handle(async () => Response.json(await backupStatus()));
export const PUT = handle(async (req: Request) => {
  await saveBackupSettings(await parseBody(req, BackupInput));
  return Response.json(await backupStatus());
});
/** Back up now. `npm run data:backup` calls this when the server holds the embedded database. */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, z.object({ withTranscripts: z.boolean().optional() }).strict());
  const backup = await runBackup(body);
  return Response.json({ backup, ...(await backupStatus()) });
});
