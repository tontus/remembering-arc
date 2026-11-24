import type { BrowserPort, MessagePort } from '../browser/port';
import { ALL_SITES, isAutoHideFrame, onSidebarModeChanged, sidePanelPortName, writeSidebarMode } from '../core/sidebar-mode';
import { RECONNECT_DELAY_MS } from './connect-to-core';

/**
 * Where the sidebar page is shown: Chrome's side panel (Docked), the Auto-hide overlay's
 * frame inside a web page, or a tab of its own, as in tests.
 */
export type SidebarHost = 'side-panel' | 'auto-hide' | 'tab';

export interface SidebarPlace {
  host: SidebarHost;
  windowId: number | undefined;
}

/** Works out where this sidebar page is shown and which window it's in. */
export async function findSidebarPlace(browser: Pick<BrowserPort, 'tabs' | 'windows'>, url: URL): Promise<SidebarPlace> {
  const [tab, window] = await Promise.all([browser.tabs.getCurrent(), browser.windows.getCurrent()]);
  const host = isAutoHideFrame(url) ? 'auto-hide' : tab === undefined ? 'side-panel' : 'tab';
  return { host, windowId: window.id };
}

/**
 * Turns Auto-hide on, asking the user for access to all websites first. Resolves with
 * whether it's on: if the user declines, the sidebar stays Docked. Call it straight from a
 * click, because Chrome asks only during a user action.
 */
export async function turnOnAutoHide(browser: Pick<BrowserPort, 'permissions' | 'storage'>): Promise<boolean> {
  const granted = await browser.permissions.request(ALL_SITES);
  if (granted) await writeSidebarMode(browser.storage.local, 'auto-hide');
  return granted;
}

/**
 * Switches to Docked and opens the side panel in the sidebar's window. Call it straight from
 * a click, because Chrome opens the side panel only during a user action.
 */
export async function switchToDocked(
  browser: Pick<BrowserPort, 'sidePanel' | 'storage'>,
  windowId: number | undefined,
): Promise<void> {
  const opening = windowId === undefined ? undefined : browser.sidePanel.open({ windowId });
  await writeSidebarMode(browser.storage.local, 'docked');
  await opening;
}

/**
 * For a sidebar page in the side panel of a window: keeps a connection to the core so it
 * knows the side panel is open there, and calls `close` when the sidebar switches to
 * Auto-hide. Returns a function that stops both.
 */
export function connectSidePanel(
  browser: Pick<BrowserPort, 'runtime' | 'storage'>,
  windowId: number,
  close: () => void,
): () => void {
  let stopped = false;
  let port: MessagePort | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    reconnectTimer = undefined;
    port = browser.runtime.connect({ name: sidePanelPortName(windowId) });
    // Chrome drops the connection when it stops the idle service worker. Reconnecting
    // starts the worker again, which then knows about this side panel once more.
    port.onDisconnect.addListener(() => {
      if (!stopped) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });
  };
  connect();

  // Only a change counts: the core switches to Docked when the side panel opens.
  const stopListening = onSidebarModeChanged(browser.storage.local, (mode) => {
    if (mode === 'auto-hide') close();
  });

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    stopListening();
    port?.disconnect();
  };
}
