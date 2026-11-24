import type { BrowserEvent } from '../port';

/**
 * An in-memory Chrome event. Like Chrome, it calls listeners asynchronously, never inside
 * the API call that caused the event, and an error in one listener doesn't stop the rest.
 */
export class FakeEvent<Listener extends (...args: never[]) => void> implements BrowserEvent<Listener> {
  readonly #listeners = new Set<Listener>();

  addListener(listener: Listener): void {
    this.#listeners.add(listener);
  }

  removeListener(listener: Listener): void {
    this.#listeners.delete(listener);
  }

  hasListener(listener: Listener): boolean {
    return this.#listeners.has(listener);
  }

  hasListeners(): boolean {
    return this.#listeners.size > 0;
  }

  /**
   * Queues a call to every listener. As in Chrome, a listener added straight after the call
   * that caused the event still hears it.
   */
  dispatch(...args: Parameters<Listener>): void {
    queueMicrotask(() => this.deliver(...args));
  }

  /** Calls every listener now. For fakes that must wrap the call, such as in a user gesture. */
  deliver(...args: Parameters<Listener>): void {
    for (const listener of [...this.#listeners]) {
      if (!this.#listeners.has(listener)) continue;
      try {
        listener(...args);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    }
  }
}
