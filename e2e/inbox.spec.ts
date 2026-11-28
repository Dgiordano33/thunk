import { mkdirSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { HISTORY, QUESTION, seedSession } from './session';
import { newWorkspace, SAMPLE, type Workspace } from './workspace';

/** Answering agents from the Inbox, against scripted sessions (no agent runs). */

const SHOTS = '.context/inbox';
mkdirSync(SHOTS, { recursive: true });

/** The test server is shared by every spec, so each test looks only at its own project's inbox. */
async function openInbox(page: Page, request: APIRequestContext, ws: Workspace) {
    const { project } = await (await request.get(`/api/workspaces/${ws.id}`)).json();
    await page.goto(`/inbox?projectId=${project.id}`);
}

const TWO_PART: Record<string, unknown>[] = [
    { type: 'user_message', messageId: 'm1', content: 'Set up the release pipeline.', kind: 'prompt' },
    { type: 'turn_start', turnId: 't1' },
    { type: 'text_delta', turnId: 't1', text: 'Two choices decide how the pipeline is built.' },
    {
        type: 'ask_question', requestId: 'q2', toolUseId: 'u1',
        questions: [
            { question: 'Where should releases build?', header: 'Runner', multiSelect: false, options: [{ label: 'GitHub Actions', description: 'Hosted runners' }, { label: 'Self-hosted', description: 'Your own machines' }] },
            { question: 'Which platforms ship first?', header: 'Platforms', multiSelect: true, options: [{ label: 'macOS', description: '' }, { label: 'Windows', description: '' }, { label: 'Linux', description: '' }] },
        ],
    },
];

test('quick context explains a request and a typed reply answers the agent without leaving the Inbox', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    const permission = await seedSession(request, ws, HISTORY, { title: 'Make the session screen work on a phone' });
    const question = await seedSession(request, ws, QUESTION, { title: 'Tidy the header' });
    await seedSession(request, ws, TWO_PART, { title: 'Release pipeline' });
    await openInbox(page, request, ws);

    // Quick context: where it came from, what was asked, what it needs, and the last exchange.
    const card = page.locator('[data-notification]', { hasText: 'Allow Bash?' });
    await expect(card).toBeVisible({ timeout: 60000 });
    await card.focus();
    await page.keyboard.press('c');
    const context = card.getByRole('region', { name: /Quick context/ });
    await expect(context.getByText('Make the session screen work on a phone', { exact: true })).toBeVisible();
    await expect(context.getByText(/^Make the session screen work on a phone, and check/)).toBeVisible();
    await expect(context.getByText('Allow or deny Bash so the agent can continue.')).toBeVisible();
    // The written summary arrives after the panel, above the facts it was written from.
    await expect(context.getByText('The agent paused here and is waiting on you.')).toBeVisible();
    await expect(context.getByText('Waiting on you', { exact: true })).toBeVisible();
    await expect(context.getByRole('log').getByText('Now run the tests.')).toBeVisible();
    await expect(context.getByText('Bash · Run the mobile browser tests')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/quick-context.png` });

    // A typed reply to a permission denies it with the note.
    await context.getByRole('textbox').fill('Run only the inbox spec instead.');
    await context.getByRole('button', { name: 'Deny with note' }).click();
    await expect(page.getByText('Denied with your note', { exact: true })).toBeVisible();
    await expect(page.locator('article[data-notification]', { hasText: 'Allow Bash?' }).getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);

    // r opens the reply box on the focused card; Enter sends a free-form answer to a question.
    const ask = page.locator('[data-notification]', { hasText: 'Which header should stay on phones?' });
    await ask.focus();
    await page.keyboard.press('r');
    const answer = ask.getByRole('textbox');
    await expect(answer).toBeFocused();
    await answer.fill('Keep the workspace bar, but drop the branch name.');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Answer sent', { exact: true })).toBeVisible();

    // Questions with several parts get a form: pick options or write your own.
    const multi = page.locator('[data-notification]', { hasText: 'Where should releases build?' });
    // The loop already opened this one; its Answer button just moves to the form.
    await expect(multi.getByRole('region', { name: /Quick context/ })).toBeVisible();
    await multi.getByRole('button', { name: 'Answer', exact: true }).click();
    await multi.getByRole('button', { name: 'GitHub Actions' }).click();
    await multi.getByRole('button', { name: 'macOS' }).click();
    await multi.getByRole('button', { name: 'Linux' }).click();
    await page.screenshot({ path: `${SHOTS}/question-form.png` });
    await multi.getByRole('button', { name: 'Send answers' }).click();
    await expect(page.getByText('No agent is waiting on a decision.')).toBeVisible();

    // The answers reached the sessions.
    await page.goto(permission.href);
    await expect(page.getByRole('img', { name: 'Denied', exact: true })).toBeVisible({ timeout: 60000 });
    await page.goto(question.href);
    await expect(page.getByText('Keep the workspace bar, but drop the branch name.')).toBeVisible({ timeout: 60000 });
});
