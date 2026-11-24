import type { StorageAreaPort, StorageChange } from '../port';
import { FakeEvent } from './fake-event';

/**
 * In-memory `chrome.storage` area. Values are stored as JSON, as Chrome stores them, and
 * `onChanged` reports only keys whose value actually changed.
 */
export class FakeStorageArea implements StorageAreaPort {
  readonly onChanged = new FakeEvent<(changes: Record<string, StorageChange>) => void>();

  readonly #items = new Map<string, string>();

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    const wanted = keys === undefined || keys === null ? [...this.#items.keys()] : [keys].flat();
    const result: Record<string, unknown> = {};
    for (const key of wanted) {
      const json = this.#items.get(key);
      if (json !== undefined) result[key] = JSON.parse(json);
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, StorageChange> = {};
    for (const [key, value] of Object.entries(items)) {
      if (value === undefined) continue;
      const json = JSON.stringify(value);
      const old = this.#items.get(key);
      if (old === json) continue;
      this.#items.set(key, json);
      changes[key] = old === undefined ? { newValue: JSON.parse(json) } : { oldValue: JSON.parse(old), newValue: JSON.parse(json) };
    }
    this.#report(changes);
  }

  async remove(keys: string | string[]): Promise<void> {
    const changes: Record<string, StorageChange> = {};
    for (const key of [keys].flat()) {
      const old = this.#items.get(key);
      if (old === undefined) continue;
      this.#items.delete(key);
      changes[key] = { oldValue: JSON.parse(old) };
    }
    this.#report(changes);
  }

  async clear(): Promise<void> {
    await this.remove([...this.#items.keys()]);
  }

  #report(changes: Record<string, StorageChange>): void {
    if (Object.keys(changes).length > 0) this.onChanged.dispatch(changes);
  }
}
