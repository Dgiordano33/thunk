"use client";
import { OnboardingHint } from "@/components/onboarding/hint";

import { useIsDesktop } from "@/components/mobile/viewport";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/client/api";
import { newChatPath } from "@/lib/routes";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** Create a workspace, remembering which repos or folders the user last selected. */
export function NewWorkspaceButton({
  projectId,
  projectSlug,
  projectName,
  repos = [],
  compact,
  hud,
  className,
}: {
  projectId: string;
  projectSlug: string;
  projectName: string;
  repos?: { id: string; name: string; kind: "repo" | "folder" }[];
  compact?: boolean;
  /** The HUD's primary "Add workspace" action, top right of a project's town. */
  hud?: boolean;
  className?: string;
}) {
  const desktop = useIsDesktop();
  const Container = desktop ? Popover : Sheet;
  const Trigger = desktop ? PopoverTrigger : SheetTrigger;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(repos.map((r) => r.id)));

  const create = async (repoIds?: string[]) => {
    setPending(true);
    try {
      const { workspace } = await api.createWorkspace({ projectId, ...(repoIds ? { repoIds } : {}) });
      try { localStorage.setItem(`thunk:workspace-repos:${projectId}`, JSON.stringify(repoIds ?? repos.map((r) => r.id))); } catch {}
      setOpen(false);
      router.push(newChatPath({ slug: projectSlug }, workspace));
      router.refresh();
    } catch (err) {
      toast.error("Couldn’t create the workspace", { description: (err as Error).message });
    } finally {
      setPending(false);
    }
  };

  const needsPicker = repos.length > 0;
  const icon = pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />;
  const trigger = compact ? (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={`New workspace in ${projectName}`}
      title="New workspace"
      className={className}
      onClick={needsPicker ? undefined : () => void create()}
      disabled={pending}
    >
      {icon}
    </Button>
  ) : hud ? (
    <Button className={className} onClick={needsPicker ? undefined : () => void create()} disabled={pending}>
      {icon}
      Add workspace
    </Button>
  ) : (
    <Button size="sm" variant="outline" className={className} onClick={needsPicker ? undefined : () => void create()} disabled={pending}>
      {icon}
      New workspace
    </Button>
  );
  const form = (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(repos.filter((r) => chosen.has(r.id)).map((r) => r.id));
          }}
          className="flex flex-col gap-3"
        >
          <OnboardingHint name="workspace-repos">Choose which repos this workspace includes. Git repos get a separate worktree, leaving your checkout in place. Shared folders use the same files, so edits affect your checkout.</OnboardingHint>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-medium">Repos in this workspace</legend>
            {repos.map((r) => (
              <Label key={r.id} className="font-normal">
                <Checkbox
                  checked={chosen.has(r.id)}
                  onCheckedChange={(on) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (on === true) next.add(r.id);
                      else next.delete(r.id);
                      return next;
                    })
                  }
                />
                {r.name}
              </Label>
            ))}
          </fieldset>
          <p className="text-muted-foreground text-xs">Folders are shared in place. With none selected, this workspace gets a scratch folder.</p>
          <Button type="submit" size="sm" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            Create workspace
          </Button>
        </form>
  );
  if (!needsPicker) return trigger;

  return (
    <Container
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          try {
            const saved: unknown = JSON.parse(localStorage.getItem(`thunk:workspace-repos:${projectId}`) ?? "null");
            setChosen(new Set(Array.isArray(saved) ? repos.filter((r) => saved.includes(r.id)).map((r) => r.id) : repos.map((r) => r.id)));
          } catch { setChosen(new Set(repos.map((r) => r.id))); }
        }
        setOpen(next);
      }}
    >
      <Trigger asChild>{trigger}</Trigger>
      {desktop ? <PopoverContent align={hud ? "end" : "start"} className="w-64 p-3">
        {form}
      </PopoverContent> : <SheetContent side="bottom" className="p-4 pb-safe" aria-describedby={undefined}><SheetTitle>New workspace</SheetTitle>{form}</SheetContent>}
    </Container>
  );
}
