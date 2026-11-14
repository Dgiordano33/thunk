import 'server-only';
import { execFile } from 'node:child_process';
import { HttpError } from '@/lib/api/errors';
import { ensureMainWorkspace } from '@/lib/projects';
import type { Project } from '@/lib/projects/types';
import { applyRefresh } from './chart';
import { lock, readCard, saveCard } from './store';

const TIMEOUT_MS = 60_000, MAX_OUTPUT = 5_000_000;

/** Runs a command in the user's login shell and returns its stdout. */
export function runSource(command: string, cwd: string) {
    return new Promise<string>((resolve, reject) => execFile(process.env.SHELL || '/bin/bash', ['-lc', command], { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, env: process.env }, (error, stdout, stderr) => {
        if (!error)
            return resolve(stdout);
        const reason = error.killed ? `timed out after ${TIMEOUT_MS / 1000}s` : `exited with ${error.code ?? 'an error'}`;
        reject(new HttpError(422, `The source command ${reason}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ''}`));
    }));
}

/**
 * Re-runs a chart's source command in the project's main workspace and swaps in the rows it prints, without an agent turn.
 * `confirmed` is the command the user was shown; it must still be the card's command, and running it approves it.
 */
export async function refreshChart(project: Project, dir: string, cardId: string, confirmed: string) {
    const before = await readCard(dir, cardId);
    if (before.kind !== 'chart' || !before.chart || !before.chartSource)
        throw new HttpError(400, 'This chart has no source command');
    if (before.chartSource.command !== confirmed)
        throw new HttpError(409, 'The source command changed. Review it and refresh again.');
    const stdout = await runSource(confirmed, (await ensureMainWorkspace(project)).cwd);
    return lock(dir, async () => {
        const c = await readCard(dir, cardId);
        if (!c.chart || c.chartSource?.command !== confirmed)
            throw new HttpError(409, 'The chart changed while refreshing. Refresh again.');
        try {
            c.chart = applyRefresh(c.chart, stdout);
        }
        catch (e) {
            throw new HttpError(422, `Refresh failed: ${(e as Error).message}`);
        }
        c.chartSource = { ...c.chartSource, approved: true, refreshedAt: new Date().toISOString() };
        return saveCard(dir, c);
    });
}
