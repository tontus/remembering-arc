import { expect, vi } from 'vitest';
import { createFakeBrowser, type FakeBrowser } from '../browser/fake/fake-browser';
import { FAKE_WINDOW_ID } from '../browser/fake/fake-tabs';
import { startCore } from '../core/core';
import type { SidebarView } from '../core/sidebar-protocol';
import type { SpaceColor } from '../library/space-color';
import { connectToCore, type CoreUpdate } from '../sidebar/connect-to-core';

// Helpers for tests that run the whole core against the fake browser, with sidebars open,
// and look at the tab strip and the sidebar view as the user would.

/** Connects a sidebar in a window to the core, as the sidebar page does, and records what it receives. */
export function openSidebar(browser: FakeBrowser, windowId = FAKE_WINDOW_ID) {
  const messages: CoreUpdate[] = [];
  const { run, close } = connectToCore(browser, windowId, (message) => messages.push(message));
  const view = (): SidebarView => {
    const latest = messages.findLast((message) => message.type === 'view')?.view;
    if (!latest) throw new Error('The sidebar has no view yet.');
    return latest;
  };
  const switchTo = async (spaceId: string) => expect(await run({ type: 'switchSpace', spaceId })).toEqual({ ok: true });
  return { run, close, view, switchTo };
}

/** A browser with the core running and a sidebar open in its first window. */
export async function startBrowser() {
  const browser = createFakeBrowser();
  startCore(browser);
  const sidebar = openSidebar(browser);
  await vi.waitFor(() => expect(sidebar.view).not.toThrow());
  const home = sidebar.view().spaces[0]!;

  /** Creates a Space from the sidebar, as the user does, and returns it. */
  const createSpace = async (label: string, color: SpaceColor, icon: string | null = null) => {
    const outcome = await sidebar.run({ type: 'createSpace', icon, label, color });
    if (!outcome.ok) throw new Error(`Could not create ${label}: ${outcome.reason}`);
    return sidebar.view().spaces.find((space) => space.id === outcome.spaceId)!;
  };

  /** The user opens a tab, and the core adds it to the window's Active Space. */
  const openTab = async (title: string, options: { windowId?: number; active?: boolean } = {}) => {
    const tab = browser.tabs.open({ url: `https://example.com/${title.toLowerCase()}`, title, ...options });
    await vi.waitFor(async () => expect((await browser.tabs.get(tab.id!)).groupId).not.toBe(-1));
    return tab.id!;
  };

  return { browser, sidebar, home, createSpace, openTab };
}

export type StripItem = string | { pinned: string } | { group: string; color: string; collapsed: boolean; tabs: string[] };

/**
 * A window's tab strip as the user sees it, left to right: each tab by its title, with `*`
 * on the active tab, and each group with its title, color, whether it's collapsed and its tabs.
 */
export async function stripOf(browser: FakeBrowser, windowId = FAKE_WINDOW_ID): Promise<StripItem[]> {
  const groups = await browser.tabGroups.query({ windowId });
  const items: StripItem[] = [];
  for (const tab of await browser.tabs.query({ windowId })) {
    const label = `${tab.title}${tab.active ? '*' : ''}`;
    const group = groups.find((each) => each.id === tab.groupId);
    const last = items.at(-1);
    if (tab.pinned) items.push({ pinned: label });
    else if (!group) items.push(label);
    else if (typeof last === 'object' && 'group' in last && last.group === group.title) last.tabs.push(label);
    else items.push({ group: group.title ?? '', color: group.color, collapsed: group.collapsed, tabs: [label] });
  }
  return items;
}

/** The titles of the Today tabs a sidebar lists, with `*` on the active tab. */
export const todayTabs = (view: SidebarView) => view.todayTabs.map((tab) => `${tab.title}${tab.active ? '*' : ''}`);
