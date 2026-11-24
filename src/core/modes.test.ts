import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeBrowser, type FakeBrowser } from '../browser/fake/fake-browser';
import { connectSidePanel, switchToDocked, turnOnAutoHide } from '../sidebar/mode-controls';
import { startCore } from './core';
import { type AutoHideLayout, readSidebarMode, writeSidebarMode } from './sidebar-mode';

const AUTO_HIDE_FILE = 'content-scripts/auto-hide.js';
const TOGGLE = 'toggle-sidebar-mode';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A browser with the core running and the user's tabs open. */
function startBrowser() {
  const browser = createFakeBrowser();
  const page = browser.tabs.open({ url: 'https://example.com/' });
  const newTab = browser.tabs.open({ url: 'chrome://newtab/', active: false });
  startCore(browser);
  return { browser, page, newTab };
}

/** Grants access to all websites through the sidebar's setting, as the user would. */
async function allowAutoHide(browser: FakeBrowser) {
  browser.permissions.promptAnswer = 'allow';
  await browser.withUserGesture(() => turnOnAutoHide(browser));
  await vi.waitFor(async () => expect(await browser.scripting.getRegisteredContentScripts()).toHaveLength(1));
  // Let the core settle, then check it kept Auto-hide on.
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(await mode(browser)).toBe('auto-hide');
}

/** Opens the sidebar page in the side panel of a window, as Chrome does once the panel opens. */
function openSidePanelPage(browser: FakeBrowser, windowId: number) {
  const onClose = vi.fn();
  cleanups.push(connectSidePanel(browser, windowId, onClose));
  return { onClose };
}

const mode = (browser: FakeBrowser) => readSidebarMode(browser.storage.local);

describe('turning on Auto-hide', () => {
  it('asks for access to all websites, then switches to Auto-hide and adds the overlay to open pages', async () => {
    const { browser, page, newTab } = startBrowser();
    browser.permissions.promptAnswer = 'allow';

    const on = await browser.withUserGesture(() => turnOnAutoHide(browser));

    expect(on).toBe(true);
    expect(browser.permissions.promptCount).toBe(1);
    expect(await mode(browser)).toBe('auto-hide');
    await vi.waitFor(() => expect(browser.scripting.injectedFiles(page.id!)).toEqual([AUTO_HIDE_FILE]));
    // Content scripts can't run on the new tab page.
    expect(browser.scripting.injectedFiles(newTab.id!)).toEqual([]);
  });

  it('keeps Docked and adds nothing to pages when the user declines', async () => {
    const { browser, page } = startBrowser();
    browser.permissions.promptAnswer = 'deny';

    const on = await browser.withUserGesture(() => turnOnAutoHide(browser));
    browser.tabs.open({ url: 'https://example.org/' });

    expect(on).toBe(false);
    expect(await mode(browser)).toBe('docked');
    expect(await browser.scripting.getRegisteredContentScripts()).toEqual([]);
    expect(browser.scripting.injectedFiles(page.id!)).toEqual([]);
  });

  it('adds the overlay to every page that loads while access is granted, and to none after', async () => {
    const { browser } = startBrowser();
    await allowAutoHide(browser);

    const before = browser.tabs.open({ url: 'https://example.org/' });
    browser.permissions.revoke(['<all_urls>']);
    await vi.waitFor(async () => expect(await browser.scripting.getRegisteredContentScripts()).toEqual([]));
    const after = browser.tabs.open({ url: 'https://example.net/' });

    expect(browser.scripting.injectedFiles(before.id!)).toEqual([AUTO_HIDE_FILE]);
    expect(browser.scripting.injectedFiles(after.id!)).toEqual([]);
  });

  it('keeps one registration when the service worker starts again', async () => {
    const browser = createFakeBrowser();
    browser.permissions.grant(['<all_urls>']);
    startCore(browser);
    await vi.waitFor(async () => expect(await browser.scripting.getRegisteredContentScripts()).toHaveLength(1));
    const errors = vi.spyOn(console, 'error');
    cleanups.push(() => errors.mockRestore());

    startCore(browser);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await browser.scripting.getRegisteredContentScripts()).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('when the user takes away access to websites', () => {
  it('falls back to Docked', async () => {
    const { browser } = startBrowser();
    await allowAutoHide(browser);

    browser.permissions.revoke(['<all_urls>']);

    await vi.waitFor(async () => expect(await mode(browser)).toBe('docked'));
    expect(await browser.scripting.getRegisteredContentScripts()).toEqual([]);
  });

  it('falls back to Docked when the core next starts, if it happened while the core was stopped', async () => {
    const browser = createFakeBrowser();
    await writeSidebarMode(browser.storage.local, 'auto-hide');

    startCore(browser);

    await vi.waitFor(async () => expect(await mode(browser)).toBe('docked'));
  });
});

describe('the shortcut', () => {
  it('opens the side panel and switches to Docked from Auto-hide', async () => {
    const { browser, page } = startBrowser();
    await allowAutoHide(browser);

    browser.commands.press(TOGGLE, page);

    await vi.waitFor(async () => expect(await mode(browser)).toBe('docked'));
    expect(browser.sidePanel.isOpen(page.windowId)).toBe(true);
  });

  it('switches to Auto-hide when the side panel is open in that window, and the side panel closes', async () => {
    const { browser, page } = startBrowser();
    await allowAutoHide(browser);
    browser.commands.press(TOGGLE, page);
    await vi.waitFor(async () => expect(await mode(browser)).toBe('docked'));
    const sidePanel = openSidePanelPage(browser, page.windowId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    browser.commands.press(TOGGLE, page);

    await vi.waitFor(async () => expect(await mode(browser)).toBe('auto-hide'));
    expect(sidePanel.onClose).toHaveBeenCalled();
  });

  it('opens the side panel in a window that has none open yet, even in Docked', async () => {
    const { browser } = startBrowser();
    await allowAutoHide(browser);
    await writeSidebarMode(browser.storage.local, 'docked');
    openSidePanelPage(browser, 1);
    const otherWindowId = browser.windows.open();
    const otherWindow = browser.tabs.open({ url: 'https://example.org/', windowId: otherWindowId });
    await new Promise((resolve) => setTimeout(resolve, 0));

    browser.commands.press(TOGGLE, otherWindow);

    await vi.waitFor(() => expect(browser.sidePanel.isOpen(otherWindowId)).toBe(true));
    expect(await mode(browser)).toBe('docked');
  });

  it('opens the side panel on pages where Auto-hide cannot run', async () => {
    const { browser, newTab } = startBrowser();
    await allowAutoHide(browser);

    browser.commands.press(TOGGLE, newTab);

    await vi.waitFor(() => expect(browser.sidePanel.isOpen(newTab.windowId)).toBe(true));
    expect(await mode(browser)).toBe('docked');
  });

  it('leaves the side panel open on pages where Auto-hide cannot run', async () => {
    const { browser, newTab } = startBrowser();
    await allowAutoHide(browser);
    await writeSidebarMode(browser.storage.local, 'docked');
    const sidePanel = openSidePanelPage(browser, newTab.windowId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    browser.commands.press(TOGGLE, newTab);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await mode(browser)).toBe('docked');
    expect(sidePanel.onClose).not.toHaveBeenCalled();
  });

  it('keeps Docked when the user has not granted access to websites', async () => {
    const { browser, page } = startBrowser();
    const sidePanel = openSidePanelPage(browser, page.windowId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    browser.commands.press(TOGGLE, page);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await mode(browser)).toBe('docked');
    expect(sidePanel.onClose).not.toHaveBeenCalled();
  });
});

describe('Docked', () => {
  it('becomes the mode when the side panel opens, as from the toolbar icon', async () => {
    const { browser, page } = startBrowser();
    await allowAutoHide(browser);

    const sidePanel = openSidePanelPage(browser, page.windowId);

    await vi.waitFor(async () => expect(await mode(browser)).toBe('docked'));
    expect(sidePanel.onClose).not.toHaveBeenCalled();
  });

  it('opens the side panel when the user turns Auto-hide off in the overlay', async () => {
    const { browser, page } = startBrowser();
    await allowAutoHide(browser);

    await browser.withUserGesture(() => switchToDocked(browser, page.windowId));

    expect(await mode(browser)).toBe('docked');
    expect(browser.sidePanel.isOpen(page.windowId)).toBe(true);
  });
});

describe('the Auto-hide overlay', () => {
  /** Asks the core which side to use, as the content script does. */
  function askForLayout(browser: FakeBrowser) {
    return new Promise<AutoHideLayout>((resolve) => {
      const port = browser.runtime.connect({ name: 'auto-hide' });
      port.onMessage.addListener((message) => {
        port.disconnect();
        resolve(message as AutoHideLayout);
      });
    });
  }

  it('goes on the side Chrome shows its side panel on', async () => {
    const { browser } = startBrowser();
    browser.sidePanel.side = 'left';

    expect(await askForLayout(browser)).toEqual({ side: 'left' });
  });

  it('goes on the right, where Chrome puts the side panel by default, when Chrome cannot say', async () => {
    const { browser } = startBrowser();
    browser.sidePanel.getLayout = undefined;

    expect(await askForLayout(browser)).toEqual({ side: 'right' });
  });
});
