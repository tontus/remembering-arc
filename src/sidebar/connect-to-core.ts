import type { BrowserPort, MessagePort } from '../browser/port';
import { type CoreMessage, SIDEBAR_PORT_NAME } from '../core/sidebar-protocol';

/** A pause before reconnecting, so a broken service worker can't cause a busy loop. */
export const RECONNECT_DELAY_MS = 250;

/**
 * Connects a sidebar to the core and passes on every message the core sends.
 *
 * Chrome stops the idle service worker, which drops the connection. Reconnecting starts the
 * worker again, and the core answers with a fresh view. Returns a function that disconnects
 * for good.
 */
export function connectToCore(
  browser: Pick<BrowserPort, 'runtime'>,
  onMessage: (message: CoreMessage) => void,
): () => void {
  let closed = false;
  let port: MessagePort | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    reconnectTimer = undefined;
    port = browser.runtime.connect({ name: SIDEBAR_PORT_NAME });
    port.onMessage.addListener((message) => onMessage(message as CoreMessage));
    port.onDisconnect.addListener(() => {
      if (!closed) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });
  };
  connect();

  return () => {
    closed = true;
    clearTimeout(reconnectTimer);
    port?.disconnect();
  };
}
