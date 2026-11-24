import path from 'node:path';
import { type BrowserContext, chromium, test as base, type Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';

const extensionPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

/** The `chrome` global inside the extension's service worker, for typing `serviceWorker.evaluate()`. */
export type Chrome = typeof browser;

export const test = base.extend<{ context: BrowserContext; serviceWorker: Worker; extensionId: string }>({
  // Branded Chrome no longer loads unpacked extensions from the command line, so this uses
  // Playwright's Chromium, in a fresh profile that isn't signed in.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
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

export const expect = test.expect;
