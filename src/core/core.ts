import type { BrowserPort, MessagePort } from '../browser/port';
import { createLibrary, type Library } from '../library/library';
import { startModes } from './modes';
import { runSidebarCommand } from './sidebar-commands';
import { type CoreMessage, SIDEBAR_PORT_NAME, type SidebarMessage } from './sidebar-protocol';

/**
 * Starts the core in the background service worker. Chrome stops the worker whenever it's
 * idle and this runs again on the next start, so the core keeps nothing in memory that it
 * can't rebuild from Chrome.
 */
export function startCore(browser: BrowserPort): void {
  // The toolbar icon opens the Docked sidebar in Chrome's side panel.
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('Could not set the side panel behavior:', error));

  const library = createLibrary(browser);
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === SIDEBAR_PORT_NAME) serveSidebar(port, library);
  });

  startModes(browser);
}

/**
 * Sends a connected sidebar its view now and after every change, until it disconnects, and
 * runs the commands it sends.
 */
function serveSidebar(port: MessagePort, library: Library): void {
  const send = (message: CoreMessage) => {
    try {
      port.postMessage(message);
    } catch {
      // The sidebar has just closed. onDisconnect unsubscribes.
    }
  };
  const unsubscribe = library.subscribe(
    (view) => send({ type: 'view', view }),
    (error) => send({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
  port.onDisconnect.addListener(unsubscribe);
  port.onMessage.addListener((message) => {
    const { type, requestId, command } = message as SidebarMessage;
    if (type !== 'command') return;
    void runSidebarCommand(library, command).then((outcome) => send({ type: 'commandResult', requestId, outcome }));
  });
}
