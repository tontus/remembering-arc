import type { BrowserPort, Tab, TabChangeInfo, TabGroup } from '../browser/port';
import type { Library } from '../library/library';
import type { LibraryStructure, Space } from '../library/structure';
import { readActiveSpaceId, resolveActiveSpace, windowOfActiveSpaceKey } from '../orchestrator/active-space';
import { spaceGroup } from '../orchestrator/space-groups';
import type { SidebarView, TodayTab } from './sidebar-protocol';

/** The sidebar view of each window that has a sidebar open, kept up to date. */
export interface WindowViews {
  /**
   * Calls `listener` with the window's view, then again whenever it changes. `onError`
   * hears about views that can't be computed. Returns a function that unsubscribes.
   */
  subscribe(windowId: number, listener: (view: SidebarView) => void, onError?: (error: unknown) => void): () => void;
  /**
   * Reads the Library and the window's tabs afresh, sends the window's sidebars the view if
   * it changed, and resolves once they have it.
   */
  refresh(windowId: number): Promise<void>;
}

/** The parts of a tab change that the view shows. */
const SHOWN_TAB_CHANGES: (keyof TabChangeInfo)[] = ['groupId', 'pinned', 'title', 'url'];

/** Combines the Library with a window's Active Space and tabs into the window's sidebar view. */
export function windowView(structure: LibraryStructure, activeSpace: Space, tabs: Tab[], groups: TabGroup[]): SidebarView {
  const group = spaceGroup(groups, activeSpace);
  const todayTabs: TodayTab[] = group
    ? tabs
        .filter((tab) => tab.groupId === group.id && tab.id !== undefined)
        .sort((a, b) => a.index - b.index)
        .map((tab) => ({ id: tab.id!, title: tab.title || tab.url || '', url: tab.url ?? '', active: tab.active }))
    : [];
  return { ...structure, activeSpaceId: activeSpace.id, todayTabs };
}

interface Subscriber {
  listener: (view: SidebarView) => void;
  onError?: (error: unknown) => void;
}

interface WindowState {
  /** Each subscriber, with the JSON of the last view it was sent. */
  subscribers: Map<Subscriber, string | undefined>;
  queue: Promise<void>;
  /** A refresh that's queued but hasn't started reading yet. */
  waiting: Promise<void> | undefined;
}

export function createWindowViews(browser: Pick<BrowserPort, 'tabs' | 'tabGroups' | 'storage'>, library: Library): WindowViews {
  const windows = new Map<number, WindowState>();
  // The Library's structure, kept while any sidebar is open, so a tab change doesn't make
  // the core read every bookmark again.
  let structure: LibraryStructure | undefined;
  let stopLibrary: (() => void) | undefined;

  const subscribersOf = (windowId: number) => [...(windows.get(windowId)?.subscribers.keys() ?? [])];

  function followLibrary(): void {
    if (stopLibrary) return;
    stopLibrary = library.subscribe(
      (next) => {
        structure = next;
        for (const windowId of windows.keys()) void refreshWindow(windowId);
      },
      (error) => {
        for (const windowId of windows.keys()) for (const subscriber of subscribersOf(windowId)) subscriber.onError?.(error);
      },
    );
  }

  async function computeAndSend(windowId: number, state: WindowState): Promise<void> {
    let view: SidebarView;
    try {
      const current = structure ?? (await library.read());
      const [tabs, groups, storedId] = await Promise.all([
        browser.tabs.query({ windowId }),
        browser.tabGroups.query({ windowId }),
        readActiveSpaceId(browser.storage.session, windowId),
      ]);
      view = windowView(current, resolveActiveSpace(current, storedId), tabs, groups);
    } catch (error) {
      for (const subscriber of state.subscribers.keys()) subscriber.onError?.(error);
      return;
    }
    const json = JSON.stringify(view);
    for (const [subscriber, sent] of state.subscribers) {
      if (sent === json) continue;
      state.subscribers.set(subscriber, json);
      try {
        subscriber.listener(view);
      } catch (error) {
        console.error('Error in a sidebar view subscriber:', error);
      }
    }
  }

  // A window's refreshes run one at a time, so an older view never arrives after a newer
  // one. A refresh asked for while one is waiting to start joins it: it hasn't read yet.
  function refreshWindow(windowId: number): Promise<void> {
    const state = windows.get(windowId);
    if (!state) return Promise.resolve();
    if (state.waiting) return state.waiting;
    const run = state.queue.then(() => {
      state.waiting = undefined;
      return computeAndSend(windowId, state);
    });
    state.waiting = run;
    state.queue = run;
    return run;
  }

  // Chrome fires these for every tab, so only windows with a sidebar open are refreshed.
  const { tabs, tabGroups } = browser;
  tabs.onCreated.addListener((tab) => void refreshWindow(tab.windowId));
  tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (SHOWN_TAB_CHANGES.some((key) => key in change)) void refreshWindow(tab.windowId);
  });
  tabs.onActivated.addListener(({ windowId }) => void refreshWindow(windowId));
  tabs.onMoved.addListener((_tabId, { windowId }) => void refreshWindow(windowId));
  tabs.onRemoved.addListener((_tabId, { windowId }) => void refreshWindow(windowId));
  tabs.onAttached.addListener((_tabId, { newWindowId }) => void refreshWindow(newWindowId));
  tabs.onDetached.addListener((_tabId, { oldWindowId }) => void refreshWindow(oldWindowId));
  tabGroups.onCreated.addListener((group) => void refreshWindow(group.windowId));
  tabGroups.onUpdated.addListener((group) => void refreshWindow(group.windowId));
  tabGroups.onRemoved.addListener((group) => void refreshWindow(group.windowId));
  browser.storage.session.onChanged.addListener((changes) => {
    for (const key of Object.keys(changes)) {
      const windowId = windowOfActiveSpaceKey(key);
      if (windowId !== undefined) void refreshWindow(windowId);
    }
  });

  return {
    subscribe(windowId, listener, onError) {
      const subscriber: Subscriber = { listener, onError };
      let state = windows.get(windowId);
      if (!state) {
        state = { subscribers: new Map(), queue: Promise.resolve(), waiting: undefined };
        windows.set(windowId, state);
      }
      state.subscribers.set(subscriber, undefined);
      followLibrary();
      void refreshWindow(windowId);
      return () => {
        state.subscribers.delete(subscriber);
        if (state.subscribers.size > 0) return;
        windows.delete(windowId);
        if (windows.size > 0) return;
        stopLibrary?.();
        stopLibrary = undefined;
        structure = undefined;
      };
    },
    async refresh(windowId) {
      // Reading the Library sends the latest structure to the subscription above.
      await library.read();
      await refreshWindow(windowId);
    },
  };
}
