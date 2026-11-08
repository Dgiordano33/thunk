"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TownPanel } from "@/components/town/town-panel";
import { PixelIcon } from "@/components/world/pixel-icon";
import type { VaultItem } from "@/lib/vault/types";
import { Dropzone } from "./dropzone";
import { ItemDetail } from "./item-detail";
import { ItemList } from "./item-list";
import { useVault } from "./use-vault";

/** The town Vault: drop zone and item list on the left, the selected item's summary and ideas on the right. */
export function VaultPanel({ projectId, closeHref }: { projectId: string; closeHref: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("item");
  // Refresh the server-rendered map when reading finishes so the building's lamps go out.
  const vault = useVault(projectId, { onSettled: () => router.refresh() });

  const select = (id: string | null) => {
    const q = new URLSearchParams(params.toString());
    q.set("building", "vault");
    if (id) q.set("item", id);
    else q.delete("item");
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  const onAdded = (items: VaultItem[]) => {
    vault.add(items);
    if (items[0]) select(items[0].id);
    router.refresh();
  };

  const selected = vault.items?.find((i) => i.id === selectedId) ?? null;

  return (
    <TownPanel
      eyebrow="Vault"
      title="Holdings"
      closeHref={closeHref}
      wide
      actions={
        <Link href="/vault" className="pixel hover:bg-muted px-2 py-1 text-xs whitespace-nowrap">
          All vaults →
        </Link>
      }
    >
      <VaultBody
        projectId={projectId}
        items={vault.items}
        error={vault.error}
        selected={selected}
        onSelect={select}
        onAdded={onAdded}
        onChange={vault.replace}
        onDeleted={(id) => {
          vault.remove(id);
          select(null);
          router.refresh();
        }}
      />
    </TownPanel>
  );
}

/** Two-pane body shared by the town panel and the world page. */
export function VaultBody({
  projectId,
  items,
  error,
  selected,
  onSelect,
  onAdded,
  onChange,
  onDeleted,
  contextOf,
}: {
  /** Upload target; omit to hide the drop zone (e.g. "All projects" on the world page). */
  projectId?: string;
  items: VaultItem[] | null;
  error?: string | null;
  selected: VaultItem | null;
  onSelect: (id: string | null) => void;
  onAdded: (items: VaultItem[]) => void;
  onChange: (item: VaultItem) => void;
  onDeleted: (id: string) => void;
  contextOf?: (item: VaultItem) => string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-b md:max-h-none md:w-64 md:border-r md:border-b-0">
        {projectId && (
          <div className="border-b p-2">
            <Dropzone projectId={projectId} onAdded={onAdded} compact />
          </div>
        )}
        {error && <p className="px-3 pt-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
        <ItemList items={items} selectedId={selected?.id} onSelect={onSelect} contextOf={contextOf} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected ? (
          <ItemDetail key={`${selected.projectId}/${selected.id}:${selected.title}`} item={selected} onChange={onChange} onDeleted={() => onDeleted(selected.id)} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="bg-[var(--w-parchment)] text-[var(--w-parchment-ink)] flex max-w-xs flex-col items-center gap-2 rounded-md p-5 text-center">
              <PixelIcon name="chest" className="size-10" />
              <p className="pixel text-sm">{items?.length ? "Pick something from the Vault" : "The Vault is empty"}</p>
              <p className="text-xs opacity-80">
                Drop in docs, PDFs, screenshots, slides or transcripts. Claude reads each one, writes a summary and pulls out the ideas worth keeping —
                send any idea to Notes or make it a Task.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
