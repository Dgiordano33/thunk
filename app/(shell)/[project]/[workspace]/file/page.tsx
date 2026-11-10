import { notFound } from "next/navigation";
import { FileEditor } from "@/components/workspace/file-editor";
import { getWorkspaceContextBySlugs } from "@/lib/projects";
import { cleanRelativePath, fileName } from "@/lib/projects/file-paths";
import { fileRoots } from "@/lib/projects/files";

export const dynamic = "force-dynamic";

type Props = PageProps<"/[project]/[workspace]/file">;

async function resolve({ params, searchParams }: Props) {
  const [{ project, workspace }, query] = await Promise.all([params, searchParams]);
  const ctx = await getWorkspaceContextBySlugs(project, workspace);
  const path = typeof query.path === "string" ? cleanRelativePath(query.path) : null;
  if (!ctx || !path) return null;
  const roots = fileRoots(ctx);
  const root = query.root ? roots.find((r) => r.id === query.root) : (roots.find((r) => r.anchor) ?? roots[0]);
  return root ? { ctx, root, path, multiRoot: roots.length > 1 } : null;
}

export async function generateMetadata(props: Props) {
  const found = await resolve(props).catch(() => null);
  return { title: found ? `${fileName(found.path)} · Thunk` : "Thunk" };
}

// A workspace file open in the editor, as a tab beside the sessions.
export default async function FilePage(props: Props) {
  const found = await resolve(props);
  if (!found) notFound();
  const { ctx, root, path, multiRoot } = found;
  return (
    <FileEditor
      key={`${root.id}:${path}`}
      workspaceId={ctx.workspace.id}
      root={root.id}
      rootLabel={multiRoot ? root.name : null}
      path={path}
    />
  );
}
