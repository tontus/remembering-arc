import { MatchPattern } from 'wxt/utils/match-patterns';
import type { Permissions, PermissionsPort } from '../port';
import { FakeEvent } from './fake-event';
import type { FakeUserGesture } from './fake-user-gesture';

/**
 * In-memory `chrome.permissions` for host access. Only the optional host permissions passed
 * in (the manifest's `optional_host_permissions`) can be requested, only during a user
 * gesture, and the user answers Chrome's prompt as `promptAnswer` says.
 */
export class FakePermissions implements PermissionsPort {
  readonly onAdded = new FakeEvent<(permissions: Permissions) => void>();
  readonly onRemoved = new FakeEvent<(permissions: Permissions) => void>();

  /** How the user answers Chrome's permission prompt. */
  promptAnswer: 'allow' | 'deny' = 'deny';
  /** How many times Chrome has shown the prompt. */
  promptCount = 0;

  readonly #origins = new Set<string>();

  constructor(
    private readonly gesture: FakeUserGesture,
    private readonly optionalOrigins: readonly string[],
  ) {}

  async request({ origins = [], permissions = [] }: Permissions): Promise<boolean> {
    if (!this.gesture.active) throw new Error('This function must be called during a user gesture');
    if (permissions.length > 0 || origins.some((origin) => !this.optionalOrigins.includes(origin))) {
      throw new Error('Only permissions specified in the manifest may be requested.');
    }
    const missing = origins.filter((origin) => !this.#origins.has(origin));
    if (missing.length === 0) return true;
    this.promptCount++;
    if (this.promptAnswer === 'deny') return false;
    this.grant(missing);
    return true;
  }

  async contains({ origins = [], permissions = [] }: Permissions): Promise<boolean> {
    if (permissions.length > 0) throw new Error('The fake models host permissions only.');
    return origins.every((origin) => this.#origins.has(origin));
  }

  /** Whether a granted host permission covers the page at `url`. */
  hasHostAccess(url: string | undefined): boolean {
    if (url === undefined) return false;
    return [...this.#origins].some((origin) => {
      try {
        return new MatchPattern(origin).includes(url);
      } catch {
        return false;
      }
    });
  }

  /** Test control: the user grants host access, in Chrome's prompt or on its extensions page. */
  grant(origins: string[]): void {
    const added = origins.filter((origin) => !this.#origins.has(origin));
    for (const origin of added) this.#origins.add(origin);
    if (added.length > 0) this.onAdded.dispatch({ origins: added, permissions: [] });
  }

  /** Test control: the user takes host access away on Chrome's extensions page. */
  revoke(origins: string[]): void {
    const removed = origins.filter((origin) => this.#origins.has(origin));
    for (const origin of removed) this.#origins.delete(origin);
    if (removed.length > 0) this.onRemoved.dispatch({ origins: removed, permissions: [] });
  }
}
