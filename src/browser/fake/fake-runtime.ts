import type { MessagePort, RuntimePort } from '../port';
import { FakeEvent } from './fake-event';

export const FAKE_EXTENSION_ID = 'fakeextensionid';

/** One end of a fake long-lived connection. */
class FakeMessagePort implements MessagePort {
  readonly onMessage = new FakeEvent<(message: unknown) => void>();
  readonly onDisconnect = new FakeEvent<() => void>();
  other!: FakeMessagePort;
  connected = true;

  constructor(
    readonly name: string,
    private readonly ports: Set<FakeMessagePort>,
  ) {
    ports.add(this);
  }

  postMessage(message: unknown): void {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    // Chrome serializes messages as JSON.
    this.other.onMessage.dispatch(JSON.parse(JSON.stringify(message ?? null)));
  }

  disconnect(): void {
    if (!this.connected) return;
    this.close();
    // Chrome tells only the other end.
    this.other.close();
    this.other.onDisconnect.dispatch();
  }

  close(): void {
    this.connected = false;
    this.ports.delete(this);
  }
}

/** In-memory `chrome.runtime`: extension URLs and long-lived messaging. */
export class FakeRuntime implements RuntimePort {
  readonly id = FAKE_EXTENSION_ID;
  readonly onConnect = new FakeEvent<(port: MessagePort) => void>();

  readonly #ports = new Set<FakeMessagePort>();

  getURL(path: string): string {
    return `chrome-extension://${this.id}/${path.replace(/^\//, '')}`;
  }

  connect({ name }: { name: string }): MessagePort {
    const local = new FakeMessagePort(name, this.#ports);
    const remote = new FakeMessagePort(name, this.#ports);
    local.other = remote;
    remote.other = local;
    if (this.onConnect.hasListeners()) {
      this.onConnect.dispatch(remote);
    } else {
      // Nothing is listening, so Chrome drops the connection at once.
      remote.close();
      local.close();
      local.onDisconnect.dispatch();
    }
    return local;
  }

  /**
   * Stands in for Chrome stopping the idle service worker: every open connection drops, and
   * both ends get `onDisconnect`.
   */
  disconnectAll(): void {
    for (const port of [...this.#ports]) {
      if (!port.connected) continue;
      port.close();
      port.onDisconnect.dispatch();
    }
  }
}
