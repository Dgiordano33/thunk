import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the Canvas. They run their own dev server on a separate build directory, with projects
 * kept in memory and board files under a fresh temp dir, so your own dev server and boards are never touched.
 */
const PORT = Number(process.env.THUNK_E2E_PORT ?? 4517);
// A tailnet-style name for the same server, so mobile tests can act as a remote phone (see lib/access.ts).
const REMOTE_HOST = 'thunk-phone.test';
process.env.THUNK_E2E_REMOTE_URL = `http://${REMOTE_HOST}:${PORT}`;
// Set once in the runner; workers inherit it, so seeding writes where the server reads.
process.env.THUNK_E2E_DATA ??= mkdtempSync(path.join(os.tmpdir(), 'thunk-e2e-'));
process.env.THUNK_E2E_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 60_000,
    expect: { timeout: 5_000 },
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: process.env.THUNK_E2E_URL,
        viewport: { width: 1400, height: 900 },
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'mobile', expect: { timeout: 30000 }, testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', launchOptions: { args: [`--host-resolver-rules=MAP ${REMOTE_HOST} 127.0.0.1`] } } }, { name: 'chromium', testIgnore: 'mobile.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
    webServer: {
        command: `npx next dev -H 127.0.0.1 --port ${PORT}`,
        url: `${process.env.THUNK_E2E_URL}/api/projects`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
            THUNK_DIST_DIR: '.next-e2e',
            THUNK_DATA_DIR: process.env.THUNK_E2E_DATA,
            NEXT_PUBLIC_THUNK_E2E: '1',
            THUNK_TRUSTED_HOSTS: REMOTE_HOST,
            THUNK_TRUSTED_USER: 'e2e@thunk.test',
            // Overrides .env.local, so projects live in memory instead of your database.
            THUNK_DATABASE: 'memory',
            DATABASE_URL: '',
        },
    },
});
