import { type BrowserPort, TAB_GROUP_ID_NONE } from '../browser/port';
import type { Library } from '../library/library';
import { LibraryCommandError } from '../library/space-commands';
import type { LibraryStructure, Space } from '../library/structure';
import { forgetActiveSpace, readActiveSpaceId, resolveActiveSpace, writeActiveSpaceId } from './active-space';
import { forgetPinnedTabLinks, linkPinnedTab, readPinnedTabLinks, unlinkPinnedTab, unlinkTab } from './pinned-tab-links';
import { findPinnedTab, openTabsOfPinnedTabs } from './pinned-tabs';
import { addToSpaceGroup, isSpaceWindow, lastActiveTab, spaceGroup, whenNotDragging } from './space-groups';

/**
 * Spaces at runtime (ADR-0002). Each Space with open tabs in a normal window has one tab
 * group there, named and colored like the Space. A window shows its Active Space by
 * expanding that Space's group and collapsing the others, so every tab stays loaded.
 */
export interface TabOrchestrator {
  /**
   * Makes a Space the window's Active Space: activates its last active tab there, or opens a
   * new tab in its group if it has none, then expands its group and collapses every other
   * Space's group in the window. Throws a `LibraryCommandError` if the Space is gone.
   */
  switchSpace(windowId: number, spaceId: string): Promise<void>;
  /** Activates one of the window's tabs. */
  activateTab(windowId: number, tabId: number): Promise<void>;
  /**
   * Shows a Pinned tab of the window's Active Space: activates its open tab in the window, or
   * opens its Pinned URL in a new tab in the Space's group if it isn't open there. Throws a
   * `LibraryCommandError` if the Pinned tab is gone.
   */
  openPinnedTab(windowId: number, pinnedTabId: string): Promise<void>;
  /**
   * Pins one of the Active Space's Today tabs: adds a Pinned tab for its current page to the
   * Space, at `toIndex` among its Pinned tabs and Folders or after them, and makes the tab
   * that Pinned tab's open tab. Returns the Pinned tab's ID.
   */
  pinTab(windowId: number, tabId: number, toIndex?: number): Promise<string>;
  /** Removes a Pinned tab. Its open tabs stay where they are, as Today tabs. */
  unpin(pinnedTabId: string): Promise<void>;
  /**
   * Takes a Pinned tab's open tab in the window back to the Pinned URL and activates it, or
   * opens the Pinned tab if it isn't open there.
   */
  returnToPinnedUrl(windowId: number, pinnedTabId: string): Promise<void>;
}

type OrchestratorBrowser = Pick<BrowserPort, 'tabs' | 'tabGroups' | 'windows' | 'storage'>;

/**
 * Starts the tab orchestrator in the service worker. It keeps nothing in memory: the Active
 * Spaces are in session storage and everything else is read from Chrome when needed.
 *
 * Any tab that ends up outside every group, such as a new tab, a link from another app or a
 * tab dragged out of its group, joins the window's Active Space. Chrome-pinned tabs are
 * left alone. Tabs in groups that belong to no Space are left alone too.
 */
export function startTabOrchestrator(browser: OrchestratorBrowser, library: Library): TabOrchestrator {
  const { tabs, tabGroups, windows } = browser;
  const { session } = browser.storage;

  // Everything that changes tabs and groups runs one step at a time, so a stray tab is
  // looked at only after a switch that may have grouped it has finished.
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  /** The window's Active Space, stored so it stays put if the Spaces are reordered. */
  async function activeSpaceOf(windowId: number, structure: LibraryStructure): Promise<Space> {
    const storedId = await readActiveSpaceId(session, windowId);
    const space = resolveActiveSpace(structure, storedId);
    if (space.id !== storedId) await writeActiveSpaceId(session, windowId, space.id);
    return space;
  }

  async function switchSpace(windowId: number, spaceId: string): Promise<void> {
    const structure = await library.read();
    const space = structure.spaces.find((each) => each.id === spaceId);
    if (!space) throw new LibraryCommandError('space-not-found');
    if (!(await isSpaceWindow(windows, windowId))) throw new Error(`Window ${windowId} doesn't take part in Spaces.`);
    await writeActiveSpaceId(session, windowId, space.id);

    const [windowTabs, groups] = await Promise.all([tabs.query({ windowId }), tabGroups.query({ windowId })]);
    const group = spaceGroup(groups, space);
    const target = group && lastActiveTab(windowTabs.filter((tab) => tab.groupId === group.id));
    let targetTabId: number;
    let groupId: number;
    if (group && target?.id !== undefined) {
      targetTabId = target.id;
      groupId = group.id;
    } else {
      // A created tab lands outside every group, so it joins the Space's group before it's
      // activated: Chrome won't move focus by itself (ADR-0002).
      const created = await tabs.create({ windowId, active: false });
      targetTabId = created.id!;
      groupId = await addToSpaceGroup(browser, windowId, space, [targetTabId]);
    }

    // The order the spike settled on: activating a tab in the target Space expands its
    // group, so the active tab is never inside a collapsed group. Then the others collapse.
    await whenNotDragging(() => tabs.update(targetTabId, { active: true }));
    // Activating the tab that's already active doesn't expand its group.
    await whenNotDragging(() => tabGroups.update(groupId, { collapsed: false }));
    const otherSpaces = new Set(structure.spaces.filter((each) => each.id !== space.id).map((each) => each.name));
    await Promise.all(
      groups
        .filter((each) => each.id !== groupId && !each.collapsed && otherSpaces.has(each.title ?? ''))
        .map((each) => whenNotDragging(() => tabGroups.update(each.id, { collapsed: true }))),
    );
  }

  async function activateTab(windowId: number, tabId: number): Promise<void> {
    const tab = await tabs.get(tabId);
    if (tab.windowId !== windowId) throw new Error(`Tab ${tabId} isn't in window ${windowId}.`);
    await whenNotDragging(() => tabs.update(tabId, { active: true }));
  }

  /** The window's Active Space with its tabs, groups and Pinned tab links there. */
  async function windowState(windowId: number, structure: LibraryStructure) {
    if (!(await isSpaceWindow(windows, windowId))) throw new Error(`Window ${windowId} doesn't take part in Spaces.`);
    const space = await activeSpaceOf(windowId, structure);
    const [windowTabs, groups, links] = await Promise.all([
      tabs.query({ windowId }),
      tabGroups.query({ windowId }),
      readPinnedTabLinks(session, windowId),
    ]);
    return { space, windowTabs, groups, openTabs: openTabsOfPinnedTabs(space, windowTabs, groups, links) };
  }

  /** A Pinned tab of the window's Active Space, and its open tab in the window, if any. */
  async function pinnedTabInWindow(windowId: number, pinnedTabId: string) {
    const structure = await library.read();
    const found = findPinnedTab(structure, pinnedTabId);
    if (!found) throw new LibraryCommandError('pinned-tab-not-found');
    const { space, openTabs } = await windowState(windowId, structure);
    // The sidebar shows only the Active Space's Pinned tabs, so this is a click that crossed
    // a switch to another Space.
    if (found.space.id !== space.id) throw new Error(`Pinned tab ${pinnedTabId} isn't in window ${windowId}'s Active Space.`);
    return { space, pinnedTab: found.pinnedTab, openTab: openTabs.get(pinnedTabId) };
  }

  async function openPinnedTab(windowId: number, pinnedTabId: string): Promise<void> {
    const { space, pinnedTab, openTab } = await pinnedTabInWindow(windowId, pinnedTabId);
    if (openTab?.id !== undefined) {
      const tabId = openTab.id;
      await whenNotDragging(() => tabs.update(tabId, { active: true }));
      return;
    }
    // Linked before it joins the group, so it's never shown as a Today tab, then grouped
    // before it's activated, as in a switch.
    const created = await tabs.create({ windowId, url: pinnedTab.pinnedUrl, active: false });
    const tabId = created.id!;
    await linkPinnedTab(session, windowId, pinnedTab.id, tabId);
    await addToSpaceGroup(browser, windowId, space, [tabId]);
    await whenNotDragging(() => tabs.update(tabId, { active: true }));
  }

  async function pinTab(windowId: number, tabId: number, toIndex?: number): Promise<string> {
    const structure = await library.read();
    const { space, windowTabs, groups, openTabs } = await windowState(windowId, structure);
    const tab = windowTabs.find((each) => each.id === tabId);
    if (!tab) throw new Error(`Tab ${tabId} isn't in window ${windowId}.`);
    if (tab.groupId !== spaceGroup(groups, space)?.id) throw new Error(`Tab ${tabId} isn't in the Active Space.`);
    if ([...openTabs.values()].some((open) => open.id === tabId)) throw new Error(`Tab ${tabId} is already a Pinned tab.`);
    if (!tab.url) throw new Error(`Tab ${tabId} hasn't loaded a page yet.`);

    const pinnedTabId = await library.createPinnedTab(space.id, { title: tab.title || tab.url, url: tab.url }, toIndex);
    await linkPinnedTab(session, windowId, pinnedTabId, tabId);
    return pinnedTabId;
  }

  async function unpin(pinnedTabId: string): Promise<void> {
    await library.unpin(pinnedTabId);
    await unlinkPinnedTab(session, pinnedTabId);
  }

  async function returnToPinnedUrl(windowId: number, pinnedTabId: string): Promise<void> {
    const { pinnedTab, openTab } = await pinnedTabInWindow(windowId, pinnedTabId);
    if (openTab?.id === undefined) return openPinnedTab(windowId, pinnedTabId);
    const tabId = openTab.id;
    await whenNotDragging(() => tabs.update(tabId, { url: pinnedTab.pinnedUrl, active: true }));
  }

  /** Adds a tab that sits outside every group to its window's Active Space, as a Today tab. */
  async function adoptIfStray(tabId: number): Promise<void> {
    let tab;
    try {
      tab = await tabs.get(tabId);
    } catch {
      return; // The tab has closed.
    }
    if (tab.pinned || tab.groupId !== TAB_GROUP_ID_NONE) return;
    if (!(await isSpaceWindow(windows, tab.windowId))) return;
    const space = await activeSpaceOf(tab.windowId, await library.read());
    await addToSpaceGroup(browser, tab.windowId, space, [tabId]);
  }

  const adopt = (tabId: number) => {
    serialized(() => adoptIfStray(tabId)).catch((error: unknown) =>
      console.error(`Could not add tab ${tabId} to its window's Active Space:`, error),
    );
  };
  tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) adopt(tab.id);
  });
  tabs.onAttached.addListener((tabId) => adopt(tabId));
  tabs.onUpdated.addListener((tabId, change) => {
    // It left its group, or it's no longer Chrome-pinned.
    if (change.groupId === TAB_GROUP_ID_NONE || change.pinned === false) adopt(tabId);
  });

  // A closed tab, or one dragged to another window, is no longer a Pinned tab's open tab
  // in its old window. In the new window it's a Today tab.
  const unlink = (windowId: number, tabId: number) => {
    serialized(() => unlinkTab(session, windowId, tabId)).catch((error: unknown) =>
      console.error(`Could not unlink tab ${tabId} from its Pinned tab:`, error),
    );
  };
  tabs.onRemoved.addListener((tabId, { windowId, isWindowClosing }) => {
    if (!isWindowClosing) unlink(windowId, tabId);
  });
  tabs.onDetached.addListener((tabId, { oldWindowId }) => unlink(oldWindowId, tabId));

  windows.onRemoved.addListener((windowId) => {
    Promise.all([forgetActiveSpace(session, windowId), forgetPinnedTabLinks(session, windowId)]).catch(
      (error: unknown) => console.error(`Could not forget the state of window ${windowId}:`, error),
    );
  });

  return {
    switchSpace: (windowId, spaceId) => serialized(() => switchSpace(windowId, spaceId)),
    activateTab: (windowId, tabId) => serialized(() => activateTab(windowId, tabId)),
    openPinnedTab: (windowId, pinnedTabId) => serialized(() => openPinnedTab(windowId, pinnedTabId)),
    pinTab: (windowId, tabId, toIndex) => serialized(() => pinTab(windowId, tabId, toIndex)),
    unpin: (pinnedTabId) => serialized(() => unpin(pinnedTabId)),
    returnToPinnedUrl: (windowId, pinnedTabId) => serialized(() => returnToPinnedUrl(windowId, pinnedTabId)),
  };
}
