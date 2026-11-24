import messages from '../../../public/_locales/en/messages.json';
import type { BrowserPort, I18nPort, SidePanelPort } from '../port';
import { type BookmarkSync, FakeBookmarks } from './fake-bookmarks';
import { FakeRuntime } from './fake-runtime';
import { FakeStorageArea } from './fake-storage';

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
}

/**
 * An in-memory browser for tests. Each call returns a fresh, independent browser, so tests
 * can't leak state into each other.
 */
export function createFakeBrowser({ bookmarkSync = 'account' }: FakeBrowserOptions = {}): FakeBrowser {
  return {
    bookmarks: new FakeBookmarks(bookmarkSync),
    storage: { sync: new FakeStorageArea(), local: new FakeStorageArea(), session: new FakeStorageArea() },
    runtime: new FakeRuntime(),
    i18n: new FakeI18n(),
    sidePanel: new FakeSidePanel(),
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

/** `chrome.sidePanel`, recording the panel behavior so tests can check it. */
export class FakeSidePanel implements SidePanelPort {
  panelBehavior = { openPanelOnActionClick: false };

  async setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void> {
    this.panelBehavior = { ...behavior };
  }
}
