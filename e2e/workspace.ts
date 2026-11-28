import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';

/** Helpers for the workspace pages: a fresh project whose workspace folder holds the given files. */

export type Workspace = { id: string; base: string; cwd: string };

let made = 0;
/** A new in-memory project with no repos; its workspace's folder gets `files` (path → contents; a path ending in / is an empty folder). */
export async function newWorkspace(request: APIRequestContext, files: Record<string, string>): Promise<Workspace> {
    const res = await request.post('/api/projects', { data: { name: `Files ${Date.now().toString(36)} ${++made}`, repos: [] } });
    expect(res.ok(), await res.text()).toBe(true);
    const { project } = await res.json();
    const created = await request.post('/api/workspaces', { data: { projectId: project.id } });
    expect(created.ok(), await created.text()).toBe(true);
    const { workspace } = await created.json();
    for (const [p, body] of Object.entries(files)) {
        const at = path.join(workspace.cwd, p);
        if (p.endsWith('/')) { mkdirSync(at, { recursive: true }); continue; }
        mkdirSync(path.dirname(at), { recursive: true });
        writeFileSync(at, body);
    }
    return { id: workspace.id, base: `/${project.slug}/${workspace.slug}`, cwd: workspace.cwd };
}

/** A small project: two folders, one nested and one empty, and files at the top. */
export const SAMPLE = {
    'README.md': '# Sample\n',
    'package.json': '{}\n',
    'src/index.ts': 'export const one = 1;\n',
    'src/util/math.ts': 'export const add = (a: number, b: number) => a + b;\n',
    'src/util/strings.ts': 'export const up = (s: string) => s.toUpperCase();\n',
    'docs/': '',
};
