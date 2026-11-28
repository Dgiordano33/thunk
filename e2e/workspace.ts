import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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

/** A project on a fresh git repo with one commit, then an edited file and a new one left uncommitted. */
export async function newGitWorkspace(request: APIRequestContext): Promise<Workspace> {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'thunk-e2e-repo-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@thunk.test', ...args], { cwd: repo });
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(repo, 'greeting.ts'), 'export const greeting = "hello";\n');
    git('add', '.');
    git('commit', '-q', '-m', 'Initial commit');
    writeFileSync(path.join(repo, 'greeting.ts'), 'export const greeting = "hello from a phone";\n');
    writeFileSync(path.join(repo, 'notes.md'), '# Notes\n');
    const res = await request.post('/api/projects', { data: { name: `Git ${Date.now().toString(36)} ${++made}`, repos: [{ source: 'existing', path: repo }] } });
    expect(res.ok(), await res.text()).toBe(true);
    const { project, workspace } = await res.json();
    return { id: workspace.id, base: `/${project.slug}/${workspace.slug}`, cwd: workspace.cwd };
}
