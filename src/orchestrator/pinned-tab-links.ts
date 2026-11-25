import type { StorageAreaPort } from '../browser/port';

/**
 * Which tab is each Pinned tab's open tab, kept per window in session extension storage, as
 * a map from Pinned tab ID to tab ID under one key per window. Chrome clears session storage
 * when the browser restarts, as it does the tab IDs (ADR-0001).
 *
 * Callers change links one at a time, on the tab orchestrator's queue, so a read and the
 * write that follows it never interleave with another change.
 */
export type PinnedTabLinks = Record<string, number>;

const KEY_PREFIX = 'pinnedTabs:';

export function pinnedTabLinksKey(windowId: number): string {
  return KEY_PREFIX + windowId;
}

/** The window a Pinned tab links key belongs to, or undefined if it isn't one. */
export function windowOfPinnedTabLinksKey(key: string): number | undefined {
  const match = /^pinnedTabs:(\d+)$/.exec(key);
  return match ? Number(match[1]) : undefined;
}

export async function readPinnedTabLinks(session: StorageAreaPort, windowId: number): Promise<PinnedTabLinks> {
  const key = pinnedTabLinksKey(windowId);
  return validLinks((await session.get(key))[key]);
}

/** Makes `tabId` the Pinned tab's open tab in the window. A tab is the open tab of one Pinned tab at most. */
export async function linkPinnedTab(session: StorageAreaPort, windowId: number, pinnedTabId: string, tabId: number): Promise<void> {
  const links = withoutTab(await readPinnedTabLinks(session, windowId), tabId);
  await write(session, windowId, { ...links, [pinnedTabId]: tabId });
}

/** Unlinks a tab in the window, for example because it closed or left the window. */
export async function unlinkTab(session: StorageAreaPort, windowId: number, tabId: number): Promise<void> {
  const links = await readPinnedTabLinks(session, windowId);
  const remaining = withoutTab(links, tabId);
  if (Object.keys(remaining).length !== Object.keys(links).length) await write(session, windowId, remaining);
}

/** Unlinks a Pinned tab in every window, for example because it was unpinned. */
export async function unlinkPinnedTab(session: StorageAreaPort, pinnedTabId: string): Promise<void> {
  const stored = await session.get(null);
  for (const [key, value] of Object.entries(stored)) {
    const windowId = windowOfPinnedTabLinksKey(key);
    if (windowId === undefined) continue;
    const { [pinnedTabId]: removed, ...remaining } = validLinks(value);
    if (removed !== undefined) await write(session, windowId, remaining);
  }
}

export async function forgetPinnedTabLinks(session: StorageAreaPort, windowId: number): Promise<void> {
  await session.remove(pinnedTabLinksKey(windowId));
}

async function write(session: StorageAreaPort, windowId: number, links: PinnedTabLinks): Promise<void> {
  if (Object.keys(links).length === 0) await forgetPinnedTabLinks(session, windowId);
  else await session.set({ [pinnedTabLinksKey(windowId)]: links });
}

function withoutTab(links: PinnedTabLinks, tabId: number): PinnedTabLinks {
  return Object.fromEntries(Object.entries(links).filter(([, linked]) => linked !== tabId));
}

function validLinks(value: unknown): PinnedTabLinks {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter(([, tabId]) => Number.isInteger(tabId))) as PinnedTabLinks;
}
