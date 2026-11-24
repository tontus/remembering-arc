import { MatchPattern } from 'wxt/utils/match-patterns';
import type { RegisteredContentScript, ScriptingPort } from '../port';
import type { FakePermissions } from './fake-permissions';
import type { FakeTabs } from './fake-tabs';

/** Hosts where Chrome never runs extension scripts. */
const WEB_STORE_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];

/**
 * Why Chrome won't run an extension's script in the page at `url`, or undefined if it will.
 * Chrome's PDF viewer is also off limits, but it can't be told apart by URL, so the fake
 * doesn't model it.
 */
function whyScriptsCantRun(url: string, permissions: FakePermissions): string | undefined {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'http:' && protocol !== 'https:') return `Cannot access a ${protocol}// URL`;
  if (WEB_STORE_HOSTS.includes(hostname)) return 'The extensions gallery cannot be scripted.';
  if (!permissions.hasHostAccess(url)) {
    return 'Cannot access contents of the page. Extension manifest must request permission to access the respective host.';
  }
  return undefined;
}

/**
 * In-memory `chrome.scripting`. Registered content scripts run in pages that load later, as
 * in Chrome, and tests read which script files ran in each tab with `injectedFiles()`.
 */
export class FakeScripting implements ScriptingPort {
  readonly #registered = new Map<string, RegisteredContentScript>();
  readonly #injected = new Map<number, string[]>();

  constructor(
    private readonly tabs: FakeTabs,
    private readonly permissions: FakePermissions,
  ) {}

  async registerContentScripts(scripts: RegisteredContentScript[]): Promise<void> {
    const ids = scripts.map((script) => script.id);
    for (const [index, id] of ids.entries()) {
      if (this.#registered.has(id) || ids.indexOf(id) !== index) throw new Error(`Duplicate script ID '${id}'`);
    }
    for (const script of scripts) {
      if (!script.matches?.length) throw new Error(`Script with ID '${script.id}' must specify 'matches'`);
    }
    for (const script of scripts) this.#registered.set(script.id, structuredClone(script));
  }

  async unregisterContentScripts({ ids }: { ids?: string[] } = {}): Promise<void> {
    const targets = ids ?? [...this.#registered.keys()];
    for (const id of targets) if (!this.#registered.has(id)) throw new Error(`Nonexistent script ID '${id}'`);
    for (const id of targets) this.#registered.delete(id);
  }

  async getRegisteredContentScripts({ ids }: { ids?: string[] } = {}): Promise<RegisteredContentScript[]> {
    return [...this.#registered.values()]
      .filter((script) => ids === undefined || ids.includes(script.id))
      .map((script) => structuredClone(script));
  }

  async executeScript({ target, files }: { target: { tabId: number }; files: string[] }): Promise<unknown[]> {
    const tab = this.tabs.get(target.tabId);
    if (!tab) throw new Error(`No tab with id: ${target.tabId}.`);
    const reason = whyScriptsCantRun(tab.url, this.permissions);
    if (reason) throw new Error(reason);
    this.#run(tab.id, files);
    return [{ frameId: 0, result: undefined }];
  }

  /** Called when a tab loads a page: Chrome runs each registered script whose `matches` cover it. */
  loadPage({ id, url }: { id: number; url: string }): void {
    this.#injected.set(id, []);
    if (whyScriptsCantRun(url, this.permissions)) return;
    for (const script of this.#registered.values()) {
      if (script.matches?.some((pattern) => new MatchPattern(pattern).includes(url))) this.#run(id, script.js);
    }
  }

  /** Test helper: the script files that have run in a tab's current page, in order. */
  injectedFiles(tabId: number): string[] {
    return [...(this.#injected.get(tabId) ?? [])];
  }

  #run(tabId: number, files: string[]): void {
    this.#injected.set(tabId, [...(this.#injected.get(tabId) ?? []), ...files]);
  }
}
