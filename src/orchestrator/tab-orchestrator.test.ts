import { describe, expect, it, vi } from 'vitest';
import { createFakeBrowser, type FakeBrowser } from '../browser/fake/fake-browser';
import { FAKE_WINDOW_ID } from '../browser/fake/fake-tabs';
import { startCore } from '../core/core';
import type { SidebarView } from '../core/sidebar-protocol';
import type { SpaceColor } from '../library/space-color';
import { connectToCore, type CoreUpdate } from '../sidebar/connect-to-core';

/** Connects a sidebar in a window to the core, as the sidebar page does, and records what it receives. */
function openSidebar(browser: FakeBrowser, windowId = FAKE_WINDOW_ID) {
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
async function startBrowser() {
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

type StripItem = string | { pinned: string } | { group: string; color: string; collapsed: boolean; tabs: string[] };

/**
 * A window's tab strip as the user sees it, left to right: each tab by its title, with `*`
 * on the active tab, and each group with its title, color, whether it's collapsed and its tabs.
 */
async function stripOf(browser: FakeBrowser, windowId = FAKE_WINDOW_ID): Promise<StripItem[]> {
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
const todayTabs = (view: SidebarView) => view.todayTabs.map((tab) => `${tab.title}${tab.active ? '*' : ''}`);

describe('switching Spaces', () => {
  it('opens a new tab in the Space’s group when it has no tabs in the window, and collapses the other Spaces', async () => {
    const { browser, sidebar, createSpace, openTab } = await startBrowser();
    await openTab('Mail');
    const work = await createSpace('Work', 'blue', '💼');

    await sidebar.switchTo(work.id);

    expect(await stripOf(browser)).toEqual([
      { group: 'Home', color: 'grey', collapsed: true, tabs: ['Mail'] },
      { group: '💼 Work', color: 'blue', collapsed: false, tabs: ['New Tab*'] },
    ]);
    expect(await browser.storage.session.get(null)).toEqual({ [`activeSpace:${FAKE_WINDOW_ID}`]: work.id });
    expect(sidebar.view().activeSpaceId).toBe(work.id);
    expect(todayTabs(sidebar.view())).toEqual(['New Tab*']);
  });

  it('goes back to the Space’s last active tab, expanding its group', async () => {
    const { browser, sidebar, home, createSpace, openTab } = await startBrowser();
    await openTab('Mail');
    const calendar = await openTab('Calendar');
    await openTab('Docs');
    browser.tabs.activate(calendar);
    const work = await createSpace('Work', 'blue');
    await sidebar.switchTo(work.id);

    await sidebar.switchTo(home.id);

    expect(await stripOf(browser)).toEqual([
      { group: 'Home', color: 'grey', collapsed: false, tabs: ['Mail', 'Calendar*', 'Docs'] },
      { group: 'Work', color: 'blue', collapsed: true, tabs: ['New Tab'] },
    ]);
    expect(sidebar.view().activeSpaceId).toBe(home.id);
    expect(todayTabs(sidebar.view())).toEqual(['Mail', 'Calendar*', 'Docs']);
  });

  it('expands the Active Space’s group when its icon is clicked again', async () => {
    const { browser, sidebar, home, openTab } = await startBrowser();
    await openTab('Mail');
    const [group] = await browser.tabGroups.query({ windowId: FAKE_WINDOW_ID });
    // The user collapses the group in the strip. Its tab stays active.
    await browser.tabGroups.update(group!.id, { collapsed: true });

    await sidebar.switchTo(home.id);

    expect(await stripOf(browser)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: ['Mail*'] }]);
  });

  it('leaves Chrome-pinned tabs and groups that belong to no Space alone', async () => {
    const { browser, sidebar, createSpace, openTab } = await startBrowser();
    browser.tabs.open({ url: 'https://music.example/', title: 'Music', pinned: true, active: false });
    const research = browser.tabs.open({ url: 'https://paper.example/', title: 'Paper', active: false });
    const researchGroup = await browser.tabs.group({ tabIds: research.id!, createProperties: { windowId: FAKE_WINDOW_ID } });
    await browser.tabGroups.update(researchGroup, { title: 'Research', color: 'green' });
    await openTab('Mail');
    const work = await createSpace('Work', 'blue');

    await sidebar.switchTo(work.id);

    expect(await stripOf(browser)).toEqual([
      { pinned: 'Music' },
      { group: 'Research', color: 'green', collapsed: false, tabs: ['Paper'] },
      { group: 'Home', color: 'grey', collapsed: true, tabs: ['Mail'] },
      { group: 'Work', color: 'blue', collapsed: false, tabs: ['New Tab*'] },
    ]);
  });

  it('turns down a switch to a Space that is gone', async () => {
    const { browser, sidebar, home, createSpace } = await startBrowser();
    const work = await createSpace('Work', 'blue');
    await browser.bookmarks.remove(work.id);

    expect(await sidebar.run({ type: 'switchSpace', spaceId: work.id })).toEqual({ ok: false, reason: 'space-not-found' });
    expect(sidebar.view().activeSpaceId).toBe(home.id);
    expect(await stripOf(browser)).toEqual([]);
  });

  it('switches once the user drops a tab they were dragging', async () => {
    const { browser, sidebar, createSpace, openTab } = await startBrowser();
    await openTab('Mail');
    const work = await createSpace('Work', 'blue');
    browser.tabs.dragging = true;

    const switching = sidebar.run({ type: 'switchSpace', spaceId: work.id });
    await new Promise((resolve) => setTimeout(resolve, 50));
    browser.tabs.dragging = false;

    expect(await switching).toEqual({ ok: true });
    expect(await stripOf(browser)).toEqual([
      { group: 'Home', color: 'grey', collapsed: true, tabs: ['Mail'] },
      { group: 'Work', color: 'blue', collapsed: false, tabs: ['New Tab*'] },
    ]);
  });
});

describe('stray tabs', () => {
  it('adds a new tab to the window’s Active Space as a Today tab, making its group if needed', async () => {
    const { browser, sidebar, createSpace, openTab } = await startBrowser();
    await openTab('Mail');
    const work = await createSpace('Work', 'blue');
    await sidebar.switchTo(work.id);

    browser.tabs.open({ url: 'https://example.com/news', title: 'News' });

    await vi.waitFor(async () =>
      expect(await stripOf(browser)).toEqual([
        { group: 'Home', color: 'grey', collapsed: true, tabs: ['Mail'] },
        { group: 'Work', color: 'blue', collapsed: false, tabs: ['New Tab', 'News*'] },
      ]),
    );
    await vi.waitFor(() => expect(todayTabs(sidebar.view())).toEqual(['New Tab', 'News*']));
  });

  it('makes the Active Space’s group, named and colored like the Space, for the first tab it gets', async () => {
    const { browser, home } = await startBrowser();

    browser.tabs.open({ url: 'https://example.com/', title: 'Example' });

    await vi.waitFor(async () =>
      expect(await stripOf(browser)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: ['Example*'] }]),
    );
    expect(await browser.storage.session.get(null)).toEqual({ [`activeSpace:${FAKE_WINDOW_ID}`]: home.id });
  });

  it('adds a tab the user drags out of a group to the Active Space, once they drop it', async () => {
    const { browser, sidebar, home, createSpace, openTab } = await startBrowser();
    await openTab('Mail');
    const work = await createSpace('Work', 'blue');
    await sidebar.switchTo(work.id);
    const report = await openTab('Report');
    await sidebar.switchTo(home.id);

    browser.tabs.dragging = true;
    browser.tabs.dragOutOfGroup(report);
    await new Promise((resolve) => setTimeout(resolve, 50));
    browser.tabs.dragging = false;

    await vi.waitFor(async () =>
      expect(await stripOf(browser)).toEqual([
        { group: 'Home', color: 'grey', collapsed: false, tabs: ['Mail*', 'Report'] },
        { group: 'Work', color: 'blue', collapsed: true, tabs: ['New Tab'] },
      ]),
    );
  });

  it('leaves a link opened from a page in that page’s group', async () => {
    const { browser, sidebar, createSpace, openTab } = await startBrowser();
    const mail = await openTab('Mail');
    const work = await createSpace('Work', 'blue');
    await sidebar.switchTo(work.id);

    browser.tabs.open({ url: 'https://example.com/message', title: 'Message', openerTabId: mail, active: false });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await stripOf(browser)).toEqual([
      { group: 'Home', color: 'grey', collapsed: true, tabs: ['Mail', 'Message'] },
      { group: 'Work', color: 'blue', collapsed: false, tabs: ['New Tab*'] },
    ]);
  });

  it('leaves Chrome-pinned tabs alone, and adds a tab to the Active Space once it’s unpinned', async () => {
    const { browser } = await startBrowser();
    const music = browser.tabs.open({ url: 'https://music.example/', title: 'Music', pinned: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await stripOf(browser)).toEqual([{ pinned: 'Music*' }]);

    browser.tabs.setPinned(music.id!, false);

    await vi.waitFor(async () =>
      expect(await stripOf(browser)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: ['Music*'] }]),
    );
  });

  it('adds a tab dragged into another window to that window’s Active Space', async () => {
    const { browser, sidebar, createSpace, openTab } = await startBrowser();
    const mail = await openTab('Mail');
    const work = await createSpace('Work', 'blue');
    const other = browser.windows.open();
    const otherSidebar = openSidebar(browser, other);
    await otherSidebar.switchTo(work.id);

    browser.tabs.dragToWindow(mail, other);

    await vi.waitFor(async () =>
      expect(await stripOf(browser, other)).toEqual([{ group: 'Work', color: 'blue', collapsed: false, tabs: ['New Tab', 'Mail*'] }]),
    );
    expect(await stripOf(browser)).toEqual([]);
    expect(sidebar.view().activeSpaceId).not.toBe(work.id);
  });

  it('leaves tabs in incognito, popup and app windows alone', async () => {
    const { browser } = await startBrowser();
    const windows = [
      browser.windows.open({ incognito: true }),
      browser.windows.open({ type: 'popup' }),
      browser.windows.open({ type: 'app' }),
    ];

    for (const windowId of windows) browser.tabs.open({ url: 'https://example.com/', title: 'Page', windowId });
    await new Promise((resolve) => setTimeout(resolve, 20));

    for (const windowId of windows) expect(await stripOf(browser, windowId)).toEqual(['Page*']);
    expect(await browser.storage.session.get(null)).toEqual({});
  });
});

describe('two windows', () => {
  it('keeps an Active Space for each window', async () => {
    const { browser, sidebar, home, createSpace, openTab } = await startBrowser();
    const work = await createSpace('Work', 'blue');
    const other = browser.windows.open();
    const otherSidebar = openSidebar(browser, other);
    await openTab('Mail');
    await openTab('Notes', { windowId: other });

    await sidebar.switchTo(work.id);

    await vi.waitFor(() => expect(otherSidebar.view().activeSpaceId).toBe(home.id));
    expect(sidebar.view().activeSpaceId).toBe(work.id);
    expect(await browser.storage.session.get(null)).toEqual({
      [`activeSpace:${FAKE_WINDOW_ID}`]: work.id,
      [`activeSpace:${other}`]: home.id,
    });
    expect(await stripOf(browser, other)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: ['Notes*'] }]);
  });

  it('shows the same Space in two windows, each with its own group and Today tabs', async () => {
    const { browser, sidebar, createSpace, openTab } = await startBrowser();
    const work = await createSpace('Work', 'blue');
    const other = browser.windows.open();
    const otherSidebar = openSidebar(browser, other);
    await sidebar.switchTo(work.id);
    await otherSidebar.switchTo(work.id);

    await openTab('Report');
    await openTab('Budget', { windowId: other });

    expect(await stripOf(browser)).toEqual([{ group: 'Work', color: 'blue', collapsed: false, tabs: ['New Tab', 'Report*'] }]);
    expect(await stripOf(browser, other)).toEqual([{ group: 'Work', color: 'blue', collapsed: false, tabs: ['New Tab', 'Budget*'] }]);
    await vi.waitFor(() => expect(todayTabs(sidebar.view())).toEqual(['New Tab', 'Report*']));
    await vi.waitFor(() => expect(todayTabs(otherSidebar.view())).toEqual(['New Tab', 'Budget*']));
  });

  it('forgets a window’s Active Space when the window closes', async () => {
    const { browser, openTab } = await startBrowser();
    const other = browser.windows.open();
    await openTab('Mail', { windowId: other });
    expect(Object.keys(await browser.storage.session.get(null))).toEqual([`activeSpace:${other}`]);

    browser.windows.close(other);

    await vi.waitFor(async () => expect(await browser.storage.session.get(null)).toEqual({}));
  });
});

describe('the sidebar’s Today tabs', () => {
  it('lists the Active Space’s Today tabs in strip order, and follows changes in the strip', async () => {
    const { browser, sidebar, openTab } = await startBrowser();
    const mail = await openTab('Mail');
    const docs = await openTab('Docs');
    browser.tabs.open({ url: 'https://example.com/reply', title: 'Reply', openerTabId: mail, active: false });
    await vi.waitFor(() => expect(todayTabs(sidebar.view())).toEqual(['Mail', 'Reply', 'Docs*']));

    browser.tabs.navigate(docs, { url: 'https://example.com/sheet', title: 'Sheet' });
    browser.tabs.close(mail);

    await vi.waitFor(() => expect(todayTabs(sidebar.view())).toEqual(['Reply', 'Sheet*']));
    expect(sidebar.view().todayTabs.at(-1)).toEqual({ id: docs, title: 'Sheet', url: 'https://example.com/sheet', active: true });
  });

  it('activates a Today tab clicked in the sidebar', async () => {
    const { browser, sidebar, openTab } = await startBrowser();
    const mail = await openTab('Mail');
    await openTab('Docs');

    expect(await sidebar.run({ type: 'activateTab', tabId: mail })).toEqual({ ok: true });

    expect(todayTabs(sidebar.view())).toEqual(['Mail*', 'Docs']);
    expect((await browser.tabs.get(mail)).active).toBe(true);
  });

  it('keeps each window’s list to its own tabs after Chrome stops the idle service worker', async () => {
    const { browser, sidebar, openTab } = await startBrowser();
    await openTab('Mail');

    browser.runtime.disconnectAll();
    await openTab('Docs');

    await vi.waitFor(() => expect(todayTabs(sidebar.view())).toEqual(['Mail', 'Docs*']));
  });
});
