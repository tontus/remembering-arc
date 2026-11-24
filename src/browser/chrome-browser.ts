import { browser } from 'wxt/browser';
import type { BrowserPort } from './port';

/**
 * The production browser port. Every member is Chrome's own API object, so each call goes
 * straight through to Chrome; the port only narrows what the rest of the code can see.
 *
 * Members are read from Chrome when first used. Chrome leaves out an API whose permission
 * the manifest doesn't request (`chrome.storage` without "storage"), so the manifest only
 * needs the permissions of the APIs the extension actually calls.
 */
export function createChromeBrowser(): BrowserPort {
  return {
    get bookmarks() {
      return browser.bookmarks;
    },
    storage: {
      get sync() {
        return browser.storage.sync;
      },
      get local() {
        return browser.storage.local;
      },
      get session() {
        return browser.storage.session;
      },
    },
    get runtime() {
      return browser.runtime;
    },
    get i18n() {
      return browser.i18n;
    },
    get sidePanel() {
      return browser.sidePanel;
    },
  };
}
