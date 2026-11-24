import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type BrowserContext, chromium, test as base, type Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';

const extensionPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

/** The `chrome` global inside the extension's service worker, for typing `serviceWorker.evaluate()`. */
export type Chrome = typeof browser;

interface Fixtures {
  /**
   * Whether the extension starts with access to all websites, which Auto-hide needs. Chrome
   * grants that optional permission only through a prompt that tests can't click, so the
   * test loads a copy of the extension that declares it as required.
   */
  allSitesAccess: boolean;
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<Fixtures>({
  allSitesAccess: [false, { option: true }],
  // Branded Chrome no longer loads unpacked extensions from the command line, so this uses
  // Playwright's Chromium, in a fresh profile that isn't signed in.
  context: async ({ allSitesAccess }, use, testInfo) => {
    const extension = allSitesAccess ? await withAllSitesAccess(testInfo.outputPath('extension')) : extensionPath;
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    await use(context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

/** Copies the built extension to `target`, with its optional host permissions made required. */
async function withAllSitesAccess(target: string): Promise<string> {
  await cp(extensionPath, target, { recursive: true });
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), ...manifest.optional_host_permissions];
  delete manifest.optional_host_permissions;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return target;
}

export const expect = test.expect;
