import messages from '../../../public/_locales/en/messages.json';
import type { BrowserPort, I18nPort, SidePanelPort, SidePanelSide } from '../port';
import { type BookmarkSync, FakeBookmarks } from './fake-bookmarks';
import { FakePermissions } from './fake-permissions';
import { FakeRuntime } from './fake-runtime';
import { FakeScripting } from './fake-scripting';
import { FakeStorageArea } from './fake-storage';
import { FakeCommands, FakeTabs, FakeWindows } from './fake-tabs';
import { FakeUserGesture } from './fake-user-gesture';

/** The manifest's `optional_host_permissions`. */
const OPTIONAL_ORIGINS = ['<all_urls>'];

export interface FakeBrowserOptions {
  /** How the profile syncs bookmarks. Defaults to `'account'`: signed in with account storage. */
  bookmarkSync?: BookmarkSync;
}

export interface FakeBrowser extends BrowserPort {
  bookmarks: FakeBookmarks;
  storage: { sync: FakeStorageArea; local: FakeStorageArea; session: FakeStorageArea };
  runtime: FakeRuntime;
  i18n: FakeI18n;
  sidePanel: FakeSidePanel;
  tabs: FakeTabs;
  windows: FakeWindows;
  commands: FakeCommands;
  permissions: FakePermissions;
  scripting: FakeScripting;
  /**
   * Test control: runs `action` as if the user had just clicked or pressed a key, so it may
   * open the side panel or ask for a permission. The gesture ends when `action` returns.
   */
  withUserGesture<T>(action: () => T): T;
}

/**
 * An in-memory browser for tests. Each call returns a fresh, independent browser, so tests
 * can't leak state into each other.
 */
export function createFakeBrowser({ bookmarkSync = 'account' }: FakeBrowserOptions = {}): FakeBrowser {
  const gesture = new FakeUserGesture();
  const permissions = new FakePermissions(gesture, OPTIONAL_ORIGINS);
  const tabs: FakeTabs = new FakeTabs(permissions, (tab) => scripting.loadPage(tab));
  const scripting = new FakeScripting(tabs, permissions);
  return {
    bookmarks: new FakeBookmarks(bookmarkSync),
    storage: { sync: new FakeStorageArea(), local: new FakeStorageArea(), session: new FakeStorageArea() },
    runtime: new FakeRuntime(),
    i18n: new FakeI18n(),
    sidePanel: new FakeSidePanel(gesture),
    tabs,
    windows: new FakeWindows(),
    commands: new FakeCommands(gesture, tabs),
    permissions,
    scripting,
    withUserGesture: (action) => gesture.run(action),
  };
}

interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

/** `chrome.i18n` in English, read from the extension's own `messages.json`. */
export class FakeI18n implements I18nPort {
  readonly #messages: Record<string, MessageEntry> = messages;

  getMessage(messageName: string, substitutions?: string | string[]): string {
    const predefined: Record<string, string> = { '@@ui_locale': 'en', '@@bidi_dir': 'ltr' };
    if (messageName in predefined) return predefined[messageName]!;

    const entry = this.#messages[messageName];
    if (!entry) return '';
    const args = substitutions === undefined ? [] : [substitutions].flat();
    const resolveArgs = (text: string) => text.replace(/\$(\d)/g, (_, n: string) => args[Number(n) - 1] ?? '');
    return entry.message
      .replace(/\$([A-Za-z0-9_@]+)\$/g, (match, name: string) => {
        const placeholder = Object.entries(entry.placeholders ?? {}).find(
          ([key]) => key.toLowerCase() === name.toLowerCase(),
        );
        return placeholder ? resolveArgs(placeholder[1].content) : match;
      })
      .replace(/\$\$/g, '$');
  }
}

/**
 * `chrome.sidePanel`, recording the panel behavior and where the panel was opened so tests
 * can check them. Opening the panel doesn't load the sidebar page; tests do that themselves.
 */
export class FakeSidePanel implements SidePanelPort {
  panelBehavior = { openPanelOnActionClick: false };
  /** The side Chrome's settings put the panel on. */
  side: SidePanelSide = 'right';
  /** Set to undefined to copy Chrome before version 140, which has no `getLayout()`. */
  getLayout?: () => Promise<{ side: SidePanelSide }> = async () => ({ side: this.side });

  readonly #openIn = new Set<number>();

  constructor(private readonly gesture: FakeUserGesture) {}

  async setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void> {
    this.panelBehavior = { ...behavior };
  }

  async open({ windowId }: { windowId: number }): Promise<void> {
    if (!this.gesture.active) throw new Error('`sidePanel.open()` may only be called in response to a user gesture.');
    this.#openIn.add(windowId);
  }

  /** Test helper: whether the panel has been opened in a window. */
  isOpen(windowId: number): boolean {
    return this.#openIn.has(windowId);
  }
}
