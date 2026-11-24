import {
  type BrowserWindow,
  TAB_GROUP_ID_NONE,
  type Tab,
  type TabChangeInfo,
  type TabGroup,
  type TabGroupColor,
  type WindowType,
} from '../port';
import { FakeEvent } from './fake-event';

/** The normal window every fake browser starts with. Tabs open in it unless a test says otherwise. */
export const FAKE_WINDOW_ID = 1;

/** Chrome's tab group colors, in the order Chrome's color picker shows them. */
const GROUP_COLORS: readonly TabGroupColor[] = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const NEW_TAB_URL = 'chrome://newtab/';
const DRAGGING_ERROR = 'Tabs cannot be edited right now (user may be dragging a tab).';

interface StripTab {
  id: number;
  windowId: number;
  active: boolean;
  pinned: boolean;
  groupId: number;
  url: string;
  title: string;
  lastAccessed: number;
}

interface StripWindow {
  id: number;
  type: WindowType;
  incognito: boolean;
  /** The window's tabs in strip order. Chrome-pinned tabs come first, and each group's tabs sit together. */
  tabIds: number[];
}

/**
 * The model behind the fake `chrome.tabs`, `chrome.tabGroups` and `chrome.windows`: windows,
 * their tab strips and tab groups, and the events Chrome fires as they change.
 *
 * Where Chrome's behavior matters to Spaces, it copies what the tab group spike observed in
 * real Chromium (ADR-0002): a tab made with `tabs.create` lands outside every group at the
 * end of the strip, activating a tab in a collapsed group expands the group, and collapsing
 * the group that holds the active tab leaves that tab active.
 */
export class FakeTabStrip {
  readonly tabEvents = {
    onCreated: new FakeEvent<(tab: Tab) => void>(),
    onUpdated: new FakeEvent<(tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void>(),
    onActivated: new FakeEvent<(activeInfo: { tabId: number; windowId: number }) => void>(),
    onMoved: new FakeEvent<(tabId: number, moveInfo: { windowId: number; fromIndex: number; toIndex: number }) => void>(),
    onRemoved: new FakeEvent<(tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void>(),
    onAttached: new FakeEvent<(tabId: number, attachInfo: { newWindowId: number; newPosition: number }) => void>(),
    onDetached: new FakeEvent<(tabId: number, detachInfo: { oldWindowId: number; oldPosition: number }) => void>(),
  };
  readonly groupEvents = {
    onCreated: new FakeEvent<(group: TabGroup) => void>(),
    onUpdated: new FakeEvent<(group: TabGroup) => void>(),
    onRemoved: new FakeEvent<(group: TabGroup) => void>(),
  };
  readonly windowEvents = {
    onRemoved: new FakeEvent<(windowId: number) => void>(),
  };

  /** Whether the user is dragging a tab. Chrome turns down tab edits until they drop it. */
  dragging = false;

  readonly #windows = new Map<number, StripWindow>();
  readonly #tabs = new Map<number, StripTab>();
  readonly #groups = new Map<number, TabGroup>();
  #nextTabId = 1;
  #nextWindowId = FAKE_WINDOW_ID;
  // Group IDs start far from tab IDs, so a test that mixes them up fails.
  #nextGroupId = 1001;
  #clock = 0;

  constructor() {
    this.openWindow({});
  }

  // --- Reading ---------------------------------------------------------------------------

  /** The tab as Chrome reports it. With the "tabs" permission that includes its URL and title. */
  tab(tabId: number): Tab | undefined {
    const tab = this.#tabs.get(tabId);
    if (!tab) return undefined;
    const index = this.#window(tab.windowId).tabIds.indexOf(tabId);
    return { ...tab, index };
  }

  /** Every tab, by window and then in strip order. */
  allTabs(): Tab[] {
    return [...this.#windows.values()].flatMap((window) => window.tabIds.map((id) => this.tab(id)!));
  }

  group(groupId: number): TabGroup | undefined {
    const group = this.#groups.get(groupId);
    return group && { ...group };
  }

  /** Every group, by window and then in strip order. */
  allGroups(): TabGroup[] {
    const ids = new Set(this.allTabs().map((tab) => tab.groupId));
    ids.delete(TAB_GROUP_ID_NONE);
    return [...ids].map((id) => this.group(id)!);
  }

  window(windowId: number): BrowserWindow | undefined {
    const window = this.#windows.get(windowId);
    return window && { id: window.id, type: window.type, incognito: window.incognito };
  }

  hasWindow(windowId: number): boolean {
    return this.#windows.has(windowId);
  }

  // --- Tabs ------------------------------------------------------------------------------

  /**
   * Opens a tab. Without an opener it goes at the end of the strip, outside every group, as
   * `tabs.create` and Ctrl+T do. A tab opened from a page goes next to its opener, in the
   * opener's group.
   */
  createTab({
    windowId,
    url = NEW_TAB_URL,
    title,
    active = true,
    pinned = false,
    openerTabId,
  }: {
    windowId: number;
    url?: string;
    title?: string;
    active?: boolean;
    pinned?: boolean;
    openerTabId?: number;
  }): Tab {
    const window = this.#window(windowId);
    const opener = openerTabId === undefined ? undefined : this.#tabs.get(openerTabId);
    const tab: StripTab = {
      id: this.#nextTabId++,
      windowId,
      active: false,
      pinned,
      groupId: !pinned && opener?.windowId === windowId ? opener.groupId : TAB_GROUP_ID_NONE,
      url,
      title: title ?? defaultTitle(url),
      lastAccessed: this.#tick(),
    };
    this.#tabs.set(tab.id, tab);
    let index: number;
    if (pinned) index = this.#pinnedCount(window);
    else if (opener?.windowId === windowId) index = window.tabIds.indexOf(opener.id) + 1;
    else index = window.tabIds.length;
    window.tabIds.splice(index, 0, tab.id);
    this.tabEvents.onCreated.dispatch(this.tab(tab.id)!);
    if (active) this.activate(tab.id);
    return this.tab(tab.id)!;
  }

  /** Makes a tab its window's active tab. If its group is collapsed, the group expands. */
  activate(tabId: number): void {
    const tab = this.#requireTab(tabId);
    if (tab.active) return;
    for (const id of this.#window(tab.windowId).tabIds) this.#tabs.get(id)!.active = false;
    tab.active = true;
    tab.lastAccessed = this.#tick();
    this.tabEvents.onActivated.dispatch({ tabId, windowId: tab.windowId });
    const group = this.#groups.get(tab.groupId);
    if (group?.collapsed) this.updateGroup(group.id, { collapsed: false });
  }

  /** Adds tabs to a group, or to a new group in `windowId`, and returns the group's ID. */
  groupTabs(tabIds: number[], target: { groupId: number } | { windowId: number }): number {
    this.refuseWhileDragging();
    if (tabIds.length === 0) throw new Error('No tabs to group.');
    const tabs = tabIds.map((id) => this.#requireTab(id));
    let group: TabGroup;
    if ('groupId' in target) {
      const existing = this.#groups.get(target.groupId);
      if (!existing) throw new Error(`No group with id: ${target.groupId}.`);
      group = existing;
    } else {
      const window = this.#window(target.windowId);
      if (window.type !== 'normal') throw new Error('Grouping is not supported by tabs in this window.');
      group = { id: this.#nextGroupId++, windowId: window.id, title: '', color: this.#unusedColor(window), collapsed: false };
    }
    const window = this.#window(group.windowId);

    // Tabs from another window move over first.
    for (const tab of tabs) if (tab.windowId !== window.id) this.#moveToWindow(tab, window, { activate: false });
    const before = this.#indexes(window);
    const oldGroups = new Set(tabs.map((tab) => tab.groupId));
    for (const tab of tabs) {
      if (tab.pinned) {
        tab.pinned = false;
        this.tabEvents.onUpdated.dispatch(tab.id, { pinned: false }, this.tab(tab.id)!);
      }
    }

    const moving = new Set(tabIds);
    const rest = window.tabIds.filter((id) => !moving.has(id));
    const span = rest.flatMap((id, index) => (this.#tabs.get(id)!.groupId === group.id ? [index] : []));
    const ordered = window.tabIds.filter((id) => moving.has(id));
    if (span.length === 0) {
      // A new group goes where its leftmost tab was, after the pinned tabs and outside any
      // other group.
      const at = Math.max(window.tabIds.indexOf(ordered[0]!), this.#pinnedCount(window, rest));
      rest.splice(this.#outsideGroups(rest, at), 0, ...ordered);
    } else {
      // Tabs left of the group join at its start, tabs right of it at its end.
      const start = span[0]!;
      const firstGroupTab = rest[start]!;
      const left = ordered.filter((id) => window.tabIds.indexOf(id) < window.tabIds.indexOf(firstGroupTab));
      const right = ordered.filter((id) => !left.includes(id));
      rest.splice(span.at(-1)! + 1, 0, ...right);
      rest.splice(start, 0, ...left);
    }
    window.tabIds = rest;

    if (!this.#groups.has(group.id)) {
      this.#groups.set(group.id, group);
      this.groupEvents.onCreated.dispatch({ ...group });
    }
    for (const tab of tabs) {
      if (tab.groupId === group.id) continue;
      tab.groupId = group.id;
      this.tabEvents.onUpdated.dispatch(tab.id, { groupId: group.id }, this.tab(tab.id)!);
    }
    this.#reportMoves(window, before, tabIds);
    for (const id of oldGroups) this.#removeGroupIfEmpty(id);
    return group.id;
  }

  /** Changes a tab's title and URL, as when its page navigates. */
  navigate(tabId: number, { url, title }: { url?: string; title?: string }): void {
    const tab = this.#requireTab(tabId);
    const changes: TabChangeInfo = {};
    if (url !== undefined && url !== tab.url) changes.url = tab.url = url;
    const nextTitle = title ?? (url === undefined ? undefined : defaultTitle(url));
    if (nextTitle !== undefined && nextTitle !== tab.title) changes.title = tab.title = nextTitle;
    if (Object.keys(changes).length > 0) this.tabEvents.onUpdated.dispatch(tabId, changes, this.tab(tabId)!);
  }

  /** Takes a tab out of its group, leaving it just after the group, as dragging it out does. */
  leaveGroup(tabId: number): void {
    const tab = this.#requireTab(tabId);
    const oldGroup = tab.groupId;
    if (oldGroup === TAB_GROUP_ID_NONE) return;
    const window = this.#window(tab.windowId);
    const before = this.#indexes(window);
    window.tabIds = window.tabIds.filter((id) => id !== tabId);
    const lastOfGroup = window.tabIds.findLastIndex((id) => this.#tabs.get(id)!.groupId === oldGroup);
    window.tabIds.splice(lastOfGroup + 1, 0, tabId);
    tab.groupId = TAB_GROUP_ID_NONE;
    this.tabEvents.onUpdated.dispatch(tabId, { groupId: TAB_GROUP_ID_NONE }, this.tab(tabId)!);
    this.#reportMoves(window, before, [tabId]);
    this.#removeGroupIfEmpty(oldGroup);
  }

  /**
   * Pins or unpins a tab, as its right-click menu in the strip does. A pinned tab leaves its
   * group for the end of the pinned tabs. An unpinned tab goes just after them, in no group.
   */
  setPinned(tabId: number, pinned: boolean): void {
    const tab = this.#requireTab(tabId);
    if (tab.pinned === pinned) return;
    const window = this.#window(tab.windowId);
    const before = this.#indexes(window);
    const oldGroup = tab.groupId;
    window.tabIds = window.tabIds.filter((id) => id !== tabId);
    window.tabIds.splice(this.#pinnedCount(window), 0, tabId);
    tab.pinned = pinned;
    tab.groupId = TAB_GROUP_ID_NONE;
    const changes: TabChangeInfo = { pinned };
    if (oldGroup !== TAB_GROUP_ID_NONE) changes.groupId = TAB_GROUP_ID_NONE;
    this.tabEvents.onUpdated.dispatch(tabId, changes, this.tab(tabId)!);
    this.#reportMoves(window, before, [tabId]);
    this.#removeGroupIfEmpty(oldGroup);
  }

  /** Moves a tab to the end of another window's strip, outside every group, and activates it there. */
  moveToWindow(tabId: number, windowId: number): void {
    const tab = this.#requireTab(tabId);
    if (tab.windowId === windowId) return;
    this.#moveToWindow(tab, this.#window(windowId), { activate: true });
  }

  /** Closes a tab. If it was active, Chrome activates the tab to its right, or else to its left. */
  closeTab(tabId: number, isWindowClosing = false): void {
    const tab = this.#requireTab(tabId);
    const window = this.#window(tab.windowId);
    const index = window.tabIds.indexOf(tabId);
    window.tabIds.splice(index, 1);
    this.#tabs.delete(tabId);
    this.tabEvents.onRemoved.dispatch(tabId, { windowId: window.id, isWindowClosing });
    if (isWindowClosing) return;
    this.#removeGroupIfEmpty(tab.groupId);
    const next = window.tabIds[index] ?? window.tabIds[index - 1];
    if (tab.active && next !== undefined) this.activate(next);
  }

  // --- Groups ----------------------------------------------------------------------------

  updateGroup(groupId: number, changes: { title?: string; color?: TabGroupColor; collapsed?: boolean }): TabGroup {
    const group = this.#groups.get(groupId);
    if (!group) throw new Error(`No group with id: ${groupId}.`);
    if (changes.color !== undefined && !GROUP_COLORS.includes(changes.color)) {
      throw new Error(`Invalid value for argument 2. Property 'color': Value must be one of ${GROUP_COLORS.join(', ')}.`);
    }
    let changed = false;
    for (const key of ['title', 'color', 'collapsed'] as const) {
      const value = changes[key];
      if (value === undefined || group[key] === value) continue;
      (group as Record<typeof key, unknown>)[key] = value;
      changed = true;
    }
    if (changed) this.groupEvents.onUpdated.dispatch({ ...group });
    return { ...group };
  }

  // --- Windows ---------------------------------------------------------------------------

  openWindow({ type = 'normal', incognito = false }: { type?: WindowType; incognito?: boolean }): number {
    const id = this.#nextWindowId++;
    this.#windows.set(id, { id, type, incognito, tabIds: [] });
    return id;
  }

  closeWindow(windowId: number): void {
    const window = this.#window(windowId);
    const groups = new Set(window.tabIds.map((id) => this.#tabs.get(id)!.groupId));
    for (const id of [...window.tabIds]) this.closeTab(id, true);
    for (const id of groups) this.#removeGroupIfEmpty(id);
    this.#windows.delete(windowId);
    this.windowEvents.onRemoved.dispatch(windowId);
  }

  // --- Helpers ---------------------------------------------------------------------------

  /** Throws Chrome's error for a tab edit while the user is dragging a tab. */
  refuseWhileDragging(): void {
    if (this.dragging) throw new Error(DRAGGING_ERROR);
  }

  #requireTab(tabId: number): StripTab {
    const tab = this.#tabs.get(tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}.`);
    return tab;
  }

  #window(windowId: number): StripWindow {
    const window = this.#windows.get(windowId);
    if (!window) throw new Error(`No window with id: ${windowId}.`);
    return window;
  }

  #tick(): number {
    this.#clock = Math.max(this.#clock + 1, Date.now());
    return this.#clock;
  }

  #pinnedCount(window: StripWindow, tabIds = window.tabIds): number {
    return tabIds.filter((id) => this.#tabs.get(id)!.pinned).length;
  }

  /** `index`, or the end of the group it would land inside. */
  #outsideGroups(tabIds: number[], index: number): number {
    const groupAt = (i: number) => this.#tabs.get(tabIds[i]!)?.groupId ?? TAB_GROUP_ID_NONE;
    if (index === 0 || index >= tabIds.length) return index;
    const splitting = groupAt(index);
    if (splitting === TAB_GROUP_ID_NONE || groupAt(index - 1) !== splitting) return index;
    let end = index;
    while (end < tabIds.length && groupAt(end) === splitting) end++;
    return end;
  }

  /** The least used color among the window's groups, as Chrome gives a new group a color of its own. */
  #unusedColor(window: StripWindow): TabGroupColor {
    const used = window.tabIds.map((id) => this.#groups.get(this.#tabs.get(id)!.groupId)?.color);
    const count = (color: TabGroupColor) => used.filter((each) => each === color).length;
    return [...GROUP_COLORS].sort((a, b) => count(a) - count(b))[0]!;
  }

  #indexes(window: StripWindow): Map<number, number> {
    return new Map(window.tabIds.map((id, index) => [id, index]));
  }

  /**
   * Fires `onMoved` for each of `movedIds` whose position changed. Chrome reports only the
   * tabs it moved, not the ones that shifted to make room.
   */
  #reportMoves(window: StripWindow, before: Map<number, number>, movedIds: number[]): void {
    for (const id of movedIds) {
      const fromIndex = before.get(id);
      const toIndex = window.tabIds.indexOf(id);
      if (fromIndex !== undefined && fromIndex !== toIndex) {
        this.tabEvents.onMoved.dispatch(id, { windowId: window.id, fromIndex, toIndex });
      }
    }
  }

  #removeGroupIfEmpty(groupId: number): void {
    const group = this.#groups.get(groupId);
    if (!group) return;
    const stillUsed = [...this.#tabs.values()].some((tab) => tab.groupId === groupId);
    if (stillUsed) return;
    this.#groups.delete(groupId);
    this.groupEvents.onRemoved.dispatch({ ...group });
  }

  #moveToWindow(tab: StripTab, to: StripWindow, { activate }: { activate: boolean }): void {
    const from = this.#window(tab.windowId);
    const oldPosition = from.tabIds.indexOf(tab.id);
    const oldGroup = tab.groupId;
    const wasActive = tab.active;
    from.tabIds.splice(oldPosition, 1);
    this.tabEvents.onDetached.dispatch(tab.id, { oldWindowId: from.id, oldPosition });
    tab.windowId = to.id;
    tab.active = false;
    tab.pinned = false;
    tab.groupId = TAB_GROUP_ID_NONE;
    to.tabIds.push(tab.id);
    this.tabEvents.onAttached.dispatch(tab.id, { newWindowId: to.id, newPosition: to.tabIds.length - 1 });
    if (oldGroup !== TAB_GROUP_ID_NONE) {
      this.tabEvents.onUpdated.dispatch(tab.id, { groupId: TAB_GROUP_ID_NONE }, this.tab(tab.id)!);
    }
    this.#removeGroupIfEmpty(oldGroup);
    const next = from.tabIds[oldPosition] ?? from.tabIds[oldPosition - 1];
    if (wasActive && next !== undefined) this.activate(next);
    if (activate) this.activate(tab.id);
  }
}

function defaultTitle(url: string): string {
  return url === NEW_TAB_URL ? 'New Tab' : url;
}
