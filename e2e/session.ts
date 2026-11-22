import { expect, type APIRequestContext } from '@playwright/test';
import type { Workspace } from './workspace';

/** A scripted live session (no agent behind it); see app/api/e2e/session/route.ts. */
export async function seedSession(request: APIRequestContext, ws: Workspace, events: Record<string, unknown>[], opts: { title?: string; status?: 'idle' | 'running' } = {}) {
    const res = await request.post('/api/e2e/session', { data: { workspaceId: ws.id, events, ...opts } });
    expect(res.ok(), await res.text()).toBe(true);
    const { id } = await res.json();
    return { id: id as string, href: `${ws.base}/${id}` };
}

const LONG_COMMAND = 'find . -type f -name "*.ts" -not -path "./node_modules/*" -exec grep -l "useIsDesktop" {} + | sort | uniq -c | sort -rn | head -40';

/** One finished turn (thinking, a tool call, a reply with a code block and a table), then a tool call waiting for permission. */
export const HISTORY: Record<string, unknown>[] = [
    { type: 'user_message', messageId: 'm1', content: 'Make the session screen work on a phone, and check components/workspace/workspace-shell.tsx while you are there.', kind: 'prompt' },
    { type: 'turn_start', turnId: 't1' },
    { type: 'thinking_delta', turnId: 't1', text: 'The header stacks four rows on a phone.' },
    { type: 'text_delta', turnId: 't1', text: 'Looking at how the shell lays out below 768px.' },
    { type: 'tool_use', turnId: 't1', toolUseId: 'u1', name: 'Bash', input: { command: LONG_COMMAND } },
    { type: 'tool_result', toolUseId: 'u1', content: '  12 ./components/workspace/workspace-panel.tsx\n   4 ./components/workspace/workspace-shell.tsx', isError: false },
    { type: 'tool_use', turnId: 't1', toolUseId: 'u2', name: 'Read', input: { file_path: '/Users/someone/code/project/components/workspace/a-rather-long-directory-name/workspace-shell.tsx' } },
    { type: 'tool_result', toolUseId: 'u2', content: 'export function WorkspaceShell() {}', isError: false },
    { type: 'text_delta', turnId: 't1', text: 'Done.' },
    {
        type: 'turn_complete', turnId: 't1', documentId: 'd1', version: 1,
        markdown: '# Phone layout\n\nThe shell now uses **one header** on small screens.\n\n```ts\nexport const query = "(min-width: 768px)"; // a long line that has to scroll inside the block rather than widen the page\n```\n\n| Area | Before | After |\n|---|---|---|\n| Header rows | 4 | 1 |\n| Composer options | Hidden in a sheet | Inline |\n\nA long path: components/workspace/a-rather-long-directory-name/another-long-directory-name/workspace-shell.tsx',
    },
    { type: 'user_message', messageId: 'm2', content: 'Now run the tests.', kind: 'prompt' },
    { type: 'turn_start', turnId: 't2' },
    { type: 'tool_use', turnId: 't2', toolUseId: 'u3', name: 'Bash', input: { command: 'npm run test:e2e -- --project mobile', description: 'Run the mobile browser tests' } },
    { type: 'permission_request', requestId: 'r1', toolUseId: 'u3', toolName: 'Bash', input: { command: 'npm run test:e2e -- --project mobile' }, suggestions: [{ type: 'addRules' }] },
];

export const QUESTION: Record<string, unknown>[] = [
    { type: 'user_message', messageId: 'm1', content: 'Tidy the header.', kind: 'prompt' },
    { type: 'turn_start', turnId: 't1' },
    { type: 'tool_use', turnId: 't1', toolUseId: 'u1', name: 'AskUserQuestion', input: {} },
    {
        type: 'ask_question', requestId: 'q1', toolUseId: 'u1',
        questions: [{ question: 'Which header should stay on phones?', header: 'Header', multiSelect: false, options: [{ label: 'Workspace bar', description: 'Sessions, branch and tools in one row' }, { label: 'Session bar', description: 'Title and status only' }] }],
    },
];
