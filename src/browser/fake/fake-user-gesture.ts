/**
 * Whether the user is acting right now. Chrome allows some calls, such as opening the side
 * panel or asking for a permission, only while a click or key press is being handled. In
 * the service worker that lasts until the listener returns, so any `await` before the call
 * loses it. The fake copies that strict rule everywhere.
 */
export class FakeUserGesture {
  #depth = 0;

  get active(): boolean {
    return this.#depth > 0;
  }

  /** Runs `action` as if the user had just clicked or pressed a key. */
  run<T>(action: () => T): T {
    this.#depth++;
    try {
      return action();
    } finally {
      this.#depth--;
    }
  }
}
