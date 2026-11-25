import type {
  BrowserWindow,
  CommandsPort,
  Tab,
  TabGroup,
  TabGroupColor,
  TabGroupsPort,
  TabsPort,
  WindowsPort,
  WindowType,
} from '../port';
import { FakeEvent } from './fake-event';
import { FAKE_WINDOW_ID, type FakeTabStrip } from './fake-tab-strip';
import type { FakeUserGesture } from './fake-user-gesture';

export { FAKE_WINDOW_ID };

type TabEvents = FakeTabStrip['tabEvents'];
type GroupEvents = FakeTabStrip['groupEvents'];

/**
 * In-memory `chrome.tabs`. The manifest asks for the "tabs" permission, so every tab's URL
 * and title are reported. Test controls stand in for what the user does in Chrome's tab
 * strip: open, close, drag and pin tabs.
 */
export class FakeTabs implements TabsPort {
  /** The tab the calling page is shown in. Leave it undefined for the side panel or the service worker. */
  current: Tab | undefined;

  readonly onCreated: TabEvents['onCreated'];
  readonly onUpdated: TabEvents['onUpdated'];
  readonly onActivated: TabEvents['onActivated'];
  readonly onMoved: TabEvents['onMoved'];
  readonly onRemoved: TabEvents['onRemoved'];
  readonly onAttached: TabEvents['onAttached'];
  readonly onDetached: TabEvents['onDetached'];

  constructor(
    private readonly strip: FakeTabStrip,
    private readonly windows: FakeWindows,
    private readonly loadPage: (tab: { id: number; url: string }) => void,
  ) {
    this.onCreated = strip.tabEvents.onCreated;
    this.onUpdated = strip.tabEvents.onUpdated;
    this.onActivated = strip.tabEvents.onActivated;
    this.onMoved = strip.tabEvents.onMoved;
    this.onRemoved = strip.tabEvents.onRemoved;
    this.onAttached = strip.tabEvents.onAttached;
    this.onDetached = strip.tabEvents.onDetached;
  }

  async query({ windowId, active, groupId }: { windowId?: number; active?: boolean; groupId?: number }): Promise<Tab[]> {
    return this.strip
      .allTabs()
      .filter(
        (tab) =>
          (windowId === undefined || tab.windowId === windowId) &&
          (active === undefined || tab.active === active) &&
          (groupId === undefined || tab.groupId === groupId),
      );
  }

  async get(tabId: number): Promise<Tab> {
    const tab = this.strip.tab(tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}.`);
    return tab;
  }

  async getCurrent(): Promise<Tab | undefined> {
    return this.current && { ...this.current };
  }

  async create({ windowId = this.windows.current, url, active = true }: { windowId?: number; url?: string; active?: boolean }): Promise<Tab> {
    return this.strip.createTab({ windowId, url, active });
  }

  async update(tabId: number, { active, url }: { active?: boolean; url?: string }): Promise<Tab | undefined> {
    this.strip.refuseWhileDragging();
    if (!this.strip.tab(tabId)) throw new Error(`No tab with id: ${tabId}.`);
    if (url !== undefined) this.strip.navigate(tabId, { url });
    if (active) this.strip.activate(tabId);
    return this.strip.tab(tabId);
  }

  async group({
    tabIds,
    groupId,
    createProperties,
  }: {
    tabIds: number | number[];
    groupId?: number;
    createProperties?: { windowId?: number };
  }): Promise<number> {
    const ids = [tabIds].flat();
    if (groupId !== undefined) return this.strip.groupTabs(ids, { groupId });
    return this.strip.groupTabs(ids, { windowId: createProperties?.windowId ?? this.windows.current });
  }

  // --- Test controls: what the user does -------------------------------------------------

  /**
   * The user opens a tab, as with Ctrl+T or a link from another app, and its page loads,
   * which runs any registered content scripts. With `openerTabId` it's a link opened from
   * that tab's page, so it joins the opener's group.
   */
  open({
    url,
    windowId = FAKE_WINDOW_ID,
    active = true,
    pinned,
    title,
    openerTabId,
  }: {
    url: string;
    windowId?: number;
    active?: boolean;
    pinned?: boolean;
    title?: string;
    openerTabId?: number;
  }): Tab {
    const tab = this.strip.createTab({ windowId, url, title, active, pinned, openerTabId });
    this.loadPage({ id: tab.id!, url });
    return tab;
  }

  /** The user clicks a tab in the strip. */
  activate(tabId: number): void {
    this.strip.activate(tabId);
  }

  /** The user closes a tab. */
  close(tabId: number): void {
    this.strip.closeTab(tabId);
  }

  /** The tab's page navigates or changes its title. */
  navigate(tabId: number, change: { url?: string; title?: string }): void {
    this.strip.navigate(tabId, change);
  }

  /** The user drags a tab out of its group, dropping it just after the group. */
  dragOutOfGroup(tabId: number): void {
    this.strip.leaveGroup(tabId);
  }

  /** The user drags a tab into another window. */
  dragToWindow(tabId: number, windowId: number): void {
    this.strip.moveToWindow(tabId, windowId);
  }

  /** The user pins or unpins a tab from its menu in the strip. */
  setPinned(tabId: number, pinned: boolean): void {
    this.strip.setPinned(tabId, pinned);
  }

  /** Whether the user is in the middle of dragging a tab, when Chrome turns down tab edits. */
  get dragging(): boolean {
    return this.strip.dragging;
  }

  set dragging(dragging: boolean) {
    this.strip.dragging = dragging;
  }

  /** The tab as Chrome reports it now, read synchronously. */
  snapshot(tabId: number): Tab | undefined {
    return this.strip.tab(tabId);
  }
}

/** In-memory `chrome.tabGroups`. Groups come and go with their tabs, through `FakeTabs`. */
export class FakeTabGroups implements TabGroupsPort {
  readonly onCreated: GroupEvents['onCreated'];
  readonly onUpdated: GroupEvents['onUpdated'];
  readonly onRemoved: GroupEvents['onRemoved'];

  constructor(private readonly strip: FakeTabStrip) {
    this.onCreated = strip.groupEvents.onCreated;
    this.onUpdated = strip.groupEvents.onUpdated;
    this.onRemoved = strip.groupEvents.onRemoved;
  }

  async get(groupId: number): Promise<TabGroup> {
    const group = this.strip.group(groupId);
    if (!group) throw new Error(`No group with id: ${groupId}.`);
    return group;
  }

  async query({ windowId }: { windowId?: number }): Promise<TabGroup[]> {
    return this.strip.allGroups().filter((group) => windowId === undefined || group.windowId === windowId);
  }

  async update(
    groupId: number,
    changes: { title?: string; color?: TabGroupColor; collapsed?: boolean },
  ): Promise<TabGroup | undefined> {
    return this.strip.updateGroup(groupId, changes);
  }
}

/** In-memory `chrome.windows`. Every fake browser starts with one normal window, `FAKE_WINDOW_ID`. */
export class FakeWindows implements WindowsPort {
  /**
   * The window the calling page is in. For the service worker, Chrome's "current window" is
   * the last focused one, where `tabs.create` and `tabs.group` act by default.
   */
  current = FAKE_WINDOW_ID;

  readonly onRemoved: FakeTabStrip['windowEvents']['onRemoved'];

  constructor(private readonly strip: FakeTabStrip) {
    this.onRemoved = strip.windowEvents.onRemoved;
  }

  async getCurrent(): Promise<{ id?: number }> {
    return { id: this.current };
  }

  async get(windowId: number): Promise<BrowserWindow> {
    const window = this.strip.window(windowId);
    if (!window) throw new Error(`No window with id: ${windowId}.`);
    return window;
  }

  /**
   * Test control: the user opens a window, with no tabs yet. Incognito windows are visible
   * only to an extension the user allows in incognito, which this models.
   */
  open({ type, incognito }: { type?: WindowType; incognito?: boolean } = {}): number {
    return this.strip.openWindow({ type, incognito });
  }

  /** Test control: the user closes a window and every tab in it. */
  close(windowId: number): void {
    this.strip.closeWindow(windowId);
  }
}

/** In-memory `chrome.commands`. */
export class FakeCommands implements CommandsPort {
  readonly onCommand = new FakeEvent<(command: string, tab?: Tab) => void>();

  constructor(
    private readonly gesture: FakeUserGesture,
    private readonly tabs: FakeTabs,
  ) {}

  /**
   * Test control: the user presses a command's shortcut while `tab` is the active tab.
   * Listeners run inside the key press's user gesture, which ends when they return.
   */
  press(command: string, tab: Tab | undefined): void {
    const seen = tab?.id === undefined ? tab : this.tabs.snapshot(tab.id);
    queueMicrotask(() => this.gesture.run(() => this.onCommand.deliver(command, seen)));
  }
}
