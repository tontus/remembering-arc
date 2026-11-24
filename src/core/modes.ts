import type { BrowserPort, MessagePort, SidePanelSide, Tab } from '../browser/port';
import {
  ALL_SITES,
  AUTO_HIDE_PORT_NAME,
  AUTO_HIDE_SCRIPT,
  type AutoHideLayout,
  readSidebarMode,
  TOGGLE_SIDEBAR_MODE_COMMAND,
  windowOfSidePanelPort,
  writeSidebarMode,
} from './sidebar-mode';

/** Where Chrome puts its side panel unless the user moves it, and so the side to use when Chrome can't say. */
const DEFAULT_SIDE: SidePanelSide = 'right';

/**
 * Runs the sidebar modes in the core (ADR-0003): the shortcut that switches between
 * Auto-hide and Docked, the Auto-hide content script, registered only while the user grants
 * access to all websites, and the fall back to Docked when that access goes away.
 */
export function startModes(browser: BrowserPort): void {
  // Windows whose side panel shows the sidebar, with how many connections each has. This
  // lives only in memory, so it starts empty each time Chrome starts the service worker, and
  // each open side panel reconnects straight after.
  const sidePanels = new Map<number, number>();
  const followPermission = serialized(() => matchAutoHideToPermission(browser));

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== TOGGLE_SIDEBAR_MODE_COMMAND || tab?.windowId === undefined) return;
    if (sidePanels.has(tab.windowId)) {
      switchToAutoHide(browser, tab).catch(logError('Could not switch to Auto-hide:'));
      return;
    }
    // Chrome opens the side panel only straight after the key press, so nothing here can
    // wait. Opening it also covers pages where Auto-hide can't run.
    browser.sidePanel.open({ windowId: tab.windowId }).catch(logError('Could not open the side panel:'));
    writeSidebarMode(browser.storage.local, 'docked').catch(logError('Could not switch to Docked:'));
  });

  browser.permissions.onAdded.addListener(() => void followPermission());
  browser.permissions.onRemoved.addListener(() => void followPermission());
  // Access may have changed while the service worker wasn't running.
  void followPermission();

  browser.runtime.onConnect.addListener((port) => {
    const windowId = windowOfSidePanelPort(port.name);
    if (windowId !== undefined) {
      trackSidePanel(browser, sidePanels, windowId, port);
    } else if (port.name === AUTO_HIDE_PORT_NAME) {
      sendLayout(browser, port).catch(logError('Could not tell Auto-hide where the side panel is:'));
    }
  });
}

/**
 * Registers the Auto-hide content script while the user grants access to all websites, and
 * unregisters it and falls back to Docked once they take that access away.
 */
async function matchAutoHideToPermission(browser: BrowserPort): Promise<void> {
  const granted = await browser.permissions.contains(ALL_SITES);
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [AUTO_HIDE_SCRIPT.id] });
  if (granted) {
    if (registered.length > 0) return;
    await browser.scripting.registerContentScripts([
      { id: AUTO_HIDE_SCRIPT.id, js: [AUTO_HIDE_SCRIPT.file], matches: ALL_SITES.origins, runAt: 'document_idle' },
    ]);
    // Chrome runs a registered script only in pages that load from now on.
    await addAutoHideToOpenTabs(browser);
    return;
  }
  if (registered.length > 0) await browser.scripting.unregisterContentScripts({ ids: [AUTO_HIDE_SCRIPT.id] });
  if ((await readSidebarMode(browser.storage.local)) !== 'auto-hide') return;
  // The user may have granted access and turned Auto-hide on since the check above.
  if (await browser.permissions.contains(ALL_SITES)) return;
  await writeSidebarMode(browser.storage.local, 'docked');
}

async function addAutoHideToOpenTabs(browser: BrowserPort): Promise<void> {
  const tabs = await browser.tabs.query({});
  // Pages where content scripts can't run, such as chrome:// pages, refuse it.
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined ? [] : [browser.scripting.executeScript({ target: { tabId: tab.id }, files: [AUTO_HIDE_SCRIPT.file] })],
    ),
  );
}

/** Switches from Docked to Auto-hide, unless Auto-hide can't run on the tab's page. */
async function switchToAutoHide(browser: BrowserPort, tab: Tab): Promise<void> {
  // Without access to websites there's no Auto-hide, so the sidebar stays Docked.
  if (tab.id === undefined || !(await browser.permissions.contains(ALL_SITES))) return;
  try {
    // Makes sure the page has the overlay. It replaces any copy already there.
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: [AUTO_HIDE_SCRIPT.file] });
  } catch {
    // Content scripts can't run on this page, so the sidebar stays in the side panel.
    return;
  }
  await writeSidebarMode(browser.storage.local, 'auto-hide');
}

function trackSidePanel(browser: BrowserPort, sidePanels: Map<number, number>, windowId: number, port: MessagePort): void {
  sidePanels.set(windowId, (sidePanels.get(windowId) ?? 0) + 1);
  port.onDisconnect.addListener(() => {
    const remaining = (sidePanels.get(windowId) ?? 1) - 1;
    if (remaining > 0) sidePanels.set(windowId, remaining);
    else sidePanels.delete(windowId);
  });
  // Docked means the side panel, so opening it, from the toolbar icon or anywhere else,
  // switches to Docked.
  writeSidebarMode(browser.storage.local, 'docked').catch(logError('Could not switch to Docked:'));
}

/** Tells an Auto-hide overlay which side of the window Chrome shows its side panel on. */
async function sendLayout(browser: BrowserPort, port: MessagePort): Promise<void> {
  let side = DEFAULT_SIDE;
  try {
    side = (await browser.sidePanel.getLayout?.())?.side ?? DEFAULT_SIDE;
  } catch {
    // Chrome couldn't report the layout, so Auto-hide uses Chrome's default side.
  }
  const layout: AutoHideLayout = { side };
  try {
    port.postMessage(layout);
  } catch {
    // The page has gone.
  }
}

/** Wraps `task` so that calls run one after another, never at once. */
function serialized(task: () => Promise<void>): () => Promise<void> {
  let queue = Promise.resolve();
  return () => (queue = queue.then(task).catch(logError('Could not match Auto-hide to the site access permission:')));
}

function logError(context: string): (error: unknown) => void {
  return (error) => console.error(context, error);
}
