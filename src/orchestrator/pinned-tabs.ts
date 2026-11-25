import type { Tab, TabGroup } from '../browser/port';
import type { LibraryStructure, PinnedTab, Space, SpaceItem } from '../library/structure';
import type { PinnedTabLinks } from './pinned-tab-links';
import { spaceGroup } from './space-groups';

/** A Space's Pinned tabs, including those inside its Folders, in sidebar order. */
export function pinnedTabsOf(space: Space): PinnedTab[] {
  const collect = (items: SpaceItem[]): PinnedTab[] =>
    items.flatMap((item) => (item.kind === 'folder' ? collect(item.items) : [item]));
  return collect(space.items);
}

/** A Pinned tab and the Space it's in, wherever it is in the Space's Folders. */
export function findPinnedTab(structure: LibraryStructure, pinnedTabId: string): { space: Space; pinnedTab: PinnedTab } | undefined {
  for (const space of structure.spaces) {
    const pinnedTab = pinnedTabsOf(space).find((each) => each.id === pinnedTabId);
    if (pinnedTab) return { space, pinnedTab };
  }
  return undefined;
}

/**
 * The open tab of each of a Space's Pinned tabs in one window, by Pinned tab ID. A linked tab
 * counts only while it's in the Space's group there. A tab that has left the group, closed or
 * gone to another window is just a tab, and the Pinned tab isn't open.
 */
export function openTabsOfPinnedTabs(space: Space, windowTabs: Tab[], groups: TabGroup[], links: PinnedTabLinks): Map<string, Tab> {
  const open = new Map<string, Tab>();
  const group = spaceGroup(groups, space);
  if (!group) return open;
  const tabsById = new Map<number, Tab>();
  for (const tab of windowTabs) if (tab.id !== undefined && tab.groupId === group.id) tabsById.set(tab.id, tab);
  for (const pinnedTab of pinnedTabsOf(space)) {
    const tabId = links[pinnedTab.id];
    const tab = tabId === undefined ? undefined : tabsById.get(tabId);
    if (tab) open.set(pinnedTab.id, tab);
  }
  return open;
}

/**
 * Whether a Pinned tab's open tab has browsed away from the Pinned URL. A tab still loading
 * its first page reports no URL yet, and hasn't wandered.
 */
export function hasWandered(pinnedTab: PinnedTab, tab: Tab): boolean {
  return Boolean(tab.url) && tab.url !== pinnedTab.pinnedUrl;
}
