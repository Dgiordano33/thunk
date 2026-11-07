import { redirect } from "next/navigation";
import { listSessions } from "@/lib/agent";

export const dynamic = "force-dynamic";

// Opening a workspace lands on its most recent session, or the new-session tab when it has none.
export default async function WorkspaceIndex({ params }: PageProps<"/w/[id]">) {
  const { id } = await params;
  const [latest] = await listSessions({ workspaceId: id, limit: 1 });
  redirect(latest ? `/w/${id}/s/${latest.id}` : `/w/${id}/new`);
}
