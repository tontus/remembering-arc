import type { BrowserPort, Tab, TabGroup } from '../browser/port';
import type { Space } from '../library/structure';

/**
 * Whether a window takes part in Spaces. Only normal windows do: incognito, popup and app
 * windows are left alone. A window that has closed doesn't.
 */
export async function isSpaceWindow(windows: BrowserPort['windows'], windowId: number): Promise<boolean> {
  try {
    const window = await windows.get(windowId);
    return window.type === 'normal' && !window.incognito;
  } catch {
    return false;
  }
}

/**
 * The tab group that holds a Space's tabs in one window. Group IDs change when Chrome
 * restarts, so a group belongs to a Space by title: its title is the Space's full name
 * (ADR-0002).
 */
export function spaceGroup(groups: TabGroup[], space: Space): TabGroup | undefined {
  return groups.find((group) => group.title === space.name);
}

/** Of a Space's tabs in one window, the one that was active last. */
export function lastActiveTab(tabs: Tab[]): Tab | undefined {
  // Among equals, the one further along the strip.
  return tabs.reduce<Tab | undefined>(
    (latest, tab) => (latest === undefined || (tab.lastAccessed ?? 0) >= (latest.lastAccessed ?? 0) ? tab : latest),
    undefined,
  );
}

/**
 * Adds tabs to a Space's group in a window, first making the group if the Space has none
 * there. A new group gets the Space's name as its title and the Space's color. Resolves
 * with the group's ID.
 */
export async function addToSpaceGroup(
  browser: Pick<BrowserPort, 'tabs' | 'tabGroups'>,
  windowId: number,
  space: Space,
  tabIds: [number, ...number[]],
): Promise<number> {
  const existing = spaceGroup(await browser.tabGroups.query({ windowId }), space);
  if (existing) {
    await whenNotDragging(() => browser.tabs.group({ tabIds, groupId: existing.id }));
    return existing.id;
  }
  const groupId = await whenNotDragging(() => browser.tabs.group({ tabIds, createProperties: { windowId } }));
  await whenNotDragging(() => browser.tabGroups.update(groupId, { title: space.name, color: space.color }));
  return groupId;
}

/** How long to keep trying a tab edit while the user drags a tab, and how often. */
const DRAG_RETRY = { attempts: 40, delayMs: 250 };

/**
 * Makes a tab edit, trying again while Chrome turns it down because the user is dragging a
 * tab. Chrome allows tab edits again once the tab is dropped.
 */
export async function whenNotDragging<T>(edit: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await edit();
    } catch (error) {
      const dragging = error instanceof Error && error.message.includes('user may be dragging a tab');
      if (!dragging || attempt >= DRAG_RETRY.attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, DRAG_RETRY.delayMs));
    }
  }
}
