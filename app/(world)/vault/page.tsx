import { Suspense } from "react";
import { VaultOverview } from "@/components/vault/vault-overview";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listAllItems } from "@/lib/vault/service";

export const metadata = { title: "Vault · Thunk" };
export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const [projects, items] = await Promise.all([listProjects().catch(() => []), listAllItems().catch(() => [])]);
  return (
    <Suspense>
      <VaultOverview projects={projects.map((p) => ({ id: p.id, name: p.name }))} initial={items} />
    </Suspense>
  );
}
