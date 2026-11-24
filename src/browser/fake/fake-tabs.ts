import type { CommandsPort, Tab, TabsPort, WindowsPort } from '../port';
import { FakeEvent } from './fake-event';
import type { FakePermissions } from './fake-permissions';
import type { FakeUserGesture } from './fake-user-gesture';

/** The window tabs open in unless a test says otherwise. */
export const FAKE_WINDOW_ID = 1;

interface FakeTab {
  id: number;
  windowId: number;
  active: boolean;
  url: string;
}

/**
 * In-memory `chrome.tabs`, enough to list tabs and load pages in them. As in Chrome without
 * the "tabs" permission, a tab's URL is reported only where the extension has host access.
 */
export class FakeTabs implements TabsPort {
  /** The tab the calling page is shown in. Leave it undefined for the side panel or the service worker. */
  current: Tab | undefined;

  readonly #tabs: FakeTab[] = [];
  #nextId = 1;

  constructor(
    private readonly permissions: FakePermissions,
    private readonly loadPage: (tab: { id: number; url: string }) => void,
  ) {}

  async query({ windowId, active }: { windowId?: number; active?: boolean }): Promise<Tab[]> {
    return this.#tabs
      .filter((tab) => (windowId === undefined || tab.windowId === windowId) && (active === undefined || tab.active === active))
      .map((tab) => this.seenByExtension(tab.id)!);
  }

  async getCurrent(): Promise<Tab | undefined> {
    return this.current && { ...this.current };
  }

  /** Test control: the user opens a tab and its page loads, which runs any registered content scripts. */
  open({ url, windowId = FAKE_WINDOW_ID, active = true }: { url: string; windowId?: number; active?: boolean }): Tab {
    if (active) for (const tab of this.#tabs) if (tab.windowId === windowId) tab.active = false;
    const tab: FakeTab = { id: this.#nextId++, windowId, active, url };
    this.#tabs.push(tab);
    this.loadPage({ id: tab.id, url });
    return { ...tab };
  }

  /** The tab with its URL, whatever the extension may see. */
  get(tabId: number): FakeTab | undefined {
    const tab = this.#tabs.find((candidate) => candidate.id === tabId);
    return tab && { ...tab };
  }

  /** The tab as Chrome reports it to the extension. */
  seenByExtension(tabId: number): Tab | undefined {
    const tab = this.get(tabId);
    if (!tab) return undefined;
    const { url, ...rest } = tab;
    return this.permissions.hasHostAccess(url) ? { ...rest, url } : rest;
  }
}

/** In-memory `chrome.windows`. */
export class FakeWindows implements WindowsPort {
  /** The window the calling page is in. */
  current = FAKE_WINDOW_ID;

  async getCurrent(): Promise<{ id?: number }> {
    return { id: this.current };
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
    const seen = tab?.id === undefined ? tab : this.tabs.seenByExtension(tab.id);
    queueMicrotask(() => this.gesture.run(() => this.onCommand.deliver(command, seen)));
  }
}
