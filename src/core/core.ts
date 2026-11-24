import type { BrowserPort, MessagePort } from '../browser/port';
import { createLibrary } from '../library/library';
import { startTabOrchestrator } from '../orchestrator/tab-orchestrator';
import { startModes } from './modes';
import { type CommandContext, runSidebarCommand } from './sidebar-commands';
import { type CoreMessage, type SidebarMessage, windowOfSidebarPort } from './sidebar-protocol';
import { createWindowViews } from './window-views';

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
  const orchestrator = startTabOrchestrator(browser, library);
  const views = createWindowViews(browser, library);
  browser.runtime.onConnect.addListener((port) => {
    const windowId = windowOfSidebarPort(port.name);
    if (windowId !== undefined) serveSidebar(port, { library, orchestrator, views, windowId });
  });

  startModes(browser);
}

/**
 * Sends a connected sidebar its window's view now and after every change, until it
 * disconnects, and runs the commands it sends.
 */
function serveSidebar(port: MessagePort, context: CommandContext): void {
  const send = (message: CoreMessage) => {
    try {
      port.postMessage(message);
    } catch {
      // The sidebar has just closed. onDisconnect unsubscribes.
    }
  };
  const unsubscribe = context.views.subscribe(
    context.windowId,
    (view) => send({ type: 'view', view }),
    (error) => send({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
  port.onDisconnect.addListener(unsubscribe);
  port.onMessage.addListener((message) => {
    const { type, requestId, command } = message as SidebarMessage;
    if (type !== 'command') return;
    void runSidebarCommand(context, command).then((outcome) => send({ type: 'commandResult', requestId, outcome }));
  });
}
