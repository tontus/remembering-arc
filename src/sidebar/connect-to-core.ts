import type { BrowserPort, MessagePort } from '../browser/port';
import {
  type CommandOutcome,
  type CoreMessage,
  SIDEBAR_PORT_NAME,
  type SidebarCommand,
  type SidebarMessage,
} from '../core/sidebar-protocol';

/** A pause before reconnecting, so a broken service worker can't cause a busy loop. */
export const RECONNECT_DELAY_MS = 250;

/** What the core sends a sidebar of its own accord. */
export type CoreUpdate = Exclude<CoreMessage, { type: 'commandResult' }>;

export interface CoreConnection {
  /** Sends the core a command and resolves with how it went. */
  run(command: SidebarCommand): Promise<CommandOutcome>;
  /** Disconnects for good. */
  close(): void;
}

const FAILED: CommandOutcome = { ok: false, reason: 'failed' };

/**
 * Connects a sidebar to the core, passes on every view the core sends, and sends the core
 * commands.
 *
 * Chrome stops the idle service worker, which drops the connection. Reconnecting starts the
 * worker again, and the core answers with a fresh view. A command waiting for a reply when
 * the connection drops resolves as failed.
 */
export function connectToCore(browser: Pick<BrowserPort, 'runtime'>, onUpdate: (update: CoreUpdate) => void): CoreConnection {
  let closed = false;
  let port: MessagePort | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let nextRequestId = 1;
  /** Commands waiting for a reply, with the connection each was sent on. */
  const waiting = new Map<number, { resolve: (outcome: CommandOutcome) => void; sentOn: MessagePort }>();

  const failWaiting = (sentOn?: MessagePort) => {
    for (const [requestId, request] of waiting) {
      if (sentOn !== undefined && request.sentOn !== sentOn) continue;
      waiting.delete(requestId);
      request.resolve(FAILED);
    }
  };

  const connect = (): MessagePort => {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const current = browser.runtime.connect({ name: SIDEBAR_PORT_NAME });
    port = current;
    current.onMessage.addListener((message) => {
      const coreMessage = message as CoreMessage;
      if (coreMessage.type !== 'commandResult') {
        onUpdate(coreMessage);
        return;
      }
      waiting.get(coreMessage.requestId)?.resolve(coreMessage.outcome);
      waiting.delete(coreMessage.requestId);
    });
    current.onDisconnect.addListener(() => {
      failWaiting(current);
      // A command may already have opened a new connection.
      if (port !== current) return;
      port = undefined;
      if (!closed) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });
    return current;
  };
  connect();

  return {
    run(command) {
      if (closed) return Promise.resolve(FAILED);
      const requestId = nextRequestId++;
      const message: SidebarMessage = { type: 'command', requestId, command };
      return new Promise((resolve) => {
        const send = (sentOn: MessagePort) => {
          waiting.set(requestId, { resolve, sentOn });
          sentOn.postMessage(message);
        };
        try {
          // A new connection starts the stopped worker again for the command.
          send(port ?? connect());
        } catch {
          // The connection has dropped, and Chrome hasn't said so yet.
          try {
            send(connect());
          } catch {
            waiting.delete(requestId);
            resolve(FAILED);
          }
        }
      });
    },
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      port?.disconnect();
      failWaiting();
    },
  };
}
