import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  /**
   * Loads a bare extension with only the "tabs" and "tabGroups" permissions in place of this
   * one, so a test sees Chrome's own behavior without the extension reacting to it.
   */
  bareExtension: boolean;
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<Fixtures>({
  allSitesAccess: [false, { option: true }],
  bareExtension: [false, { option: true }],
  // Branded Chrome no longer loads unpacked extensions from the command line, so this uses
  // Playwright's Chromium, in a fresh profile that isn't signed in.
  context: async ({ allSitesAccess, bareExtension }, use, testInfo) => {
    const extension = bareExtension
      ? await writeBareExtension(testInfo.outputPath('bare-extension'))
      : allSitesAccess
        ? await withAllSitesAccess(testInfo.outputPath('extension'))
        : extensionPath;
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

/**
 * Waits until the core is running in the service worker. Chrome may create the first tabs of
 * a fresh install before then, and the core never hears about those.
 */
export async function coreStarted(serviceWorker: Worker): Promise<void> {
  // The core sets the panel behavior as it starts, after adding its event listeners.
  await test
    .expect(async () => {
      const behavior = await serviceWorker.evaluate(() =>
        (globalThis as unknown as { chrome: Chrome }).chrome.sidePanel.getPanelBehavior(),
      );
      test.expect(behavior).toEqual({ openPanelOnActionClick: true });
    })
    .toPass();
}

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

/** Writes an extension that does nothing, with a service worker to run scripts in. */
async function writeBareExtension(target: string): Promise<string> {
  await mkdir(target, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: 'Bare extension',
    version: '1',
    permissions: ['tabs', 'tabGroups'],
    background: { service_worker: 'worker.js' },
  };
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(target, 'worker.js'), '// Tests run their scripts here.\n');
  return target;
}

export const expect = test.expect;
