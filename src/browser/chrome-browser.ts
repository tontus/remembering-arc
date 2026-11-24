import { browser } from 'wxt/browser';
import type { BrowserPort, RegisteredContentScript, ScriptingPort } from './port';

/**
 * The production browser port. Every member is Chrome's own API object, or a thin adapter
 * where WXT's types differ, so each call goes straight through to Chrome; the port only
 * narrows what the rest of the code can see.
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
    get tabs() {
      return browser.tabs;
    },
    get windows() {
      return browser.windows;
    },
    get commands() {
      return browser.commands;
    },
    get permissions() {
      return browser.permissions;
    },
    get scripting() {
      const { scripting } = browser;
      const port: ScriptingPort = {
        registerContentScripts: (scripts) => scripting.registerContentScripts(scripts),
        unregisterContentScripts: (filter) => scripting.unregisterContentScripts(filter),
        // The extension registers JavaScript only, so every script has `js`.
        getRegisteredContentScripts: (filter) =>
          scripting.getRegisteredContentScripts(filter) as Promise<RegisteredContentScript[]>,
        // WXT types `files` as the script paths it built, which the port doesn't know.
        executeScript: (injection) => scripting.executeScript(injection as Parameters<typeof scripting.executeScript>[0]),
      };
      return port;
    },
  };
}
