import { describe, expect, it, vi } from 'vitest';
import type { FakeBrowser } from '../browser/fake/fake-browser';
import { FAKE_WINDOW_ID } from '../browser/fake/fake-tabs';
import type { SidebarView } from '../core/sidebar-protocol';
import type { Space, SpaceItem } from '../library/structure';
import { openSidebar, startBrowser, stripOf, todayTabs } from './testing';

const DOCS = 'https://docs.example.com/';
const BOARD = 'https://board.example.com/';

/**
 * Each of the Active Space's Pinned tabs as the sidebar shows it, Folders included: its name,
 * then `*` if its tab is the active tab, `(wandered: page)` if the tab browsed away, or
 * `(not open)`.
 */
function pinnedTabs(view: SidebarView): string[] {
  const space = view.spaces.find((each) => each.id === view.activeSpaceId)!;
  const describe = (items: SpaceItem[]): string[] =>
    items.flatMap((item) => {
      if (item.kind === 'folder') return describe(item.items);
      const open = view.openPinnedTabs[item.id];
      if (!open) return [`${item.title} (not open)`];
      return [`${item.title}${open.active ? '*' : ''}${open.wandered ? ` (wandered: ${open.title})` : ''}`];
    });
  return describe(space.items);
}

/** Adds a Pinned tab to a Space, as the bookmark manager or another device does, and returns its ID. */
async function addPinnedTab(browser: FakeBrowser, space: Space, title: string, url: string, parentId = space.id) {
  return (await browser.bookmarks.create({ parentId, title, url })).id;
}

/** A browser with the core running, a sidebar open, and a Pinned tab for Docs in Home. */
async function startWithDocs() {
  const started = await startBrowser();
  const docs = await addPinnedTab(started.browser, started.home, 'Docs', DOCS);
  await vi.waitFor(() => expect(pinnedTabs(started.sidebar.view())).toEqual(['Docs (not open)']));
  /** Clicks a Pinned tab in a sidebar. */
  const click = async (pinnedTabId: string, sidebar = started.sidebar) =>
    expect(await sidebar.run({ type: 'openPinnedTab', pinnedTabId })).toEqual({ ok: true });
  /** The tab a Pinned tab is open in, in the sidebar's window. */
  const openTabOf = (pinnedTabId: string, sidebar = started.sidebar) => sidebar.view().openPinnedTabs[pinnedTabId]?.tabId;
  return { ...started, docs, click, openTabOf };
}

describe('opening Pinned tabs', () => {
  it('opens a Pinned tab that isn’t open in a new tab in the Active Space’s group, and activates it', async () => {
    const { browser, sidebar, docs, click, openTab } = await startWithDocs();
    await openTab('Mail');

    await click(docs);

    expect(await stripOf(browser)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: ['Mail', `${DOCS}*`] }]);
    expect(pinnedTabs(sidebar.view())).toEqual(['Docs*']);
    expect(todayTabs(sidebar.view())).toEqual(['Mail']);
  });

  it('activates a Pinned tab’s open tab instead of opening another', async () => {
    const { browser, sidebar, docs, click, openTabOf } = await startWithDocs();
    await click(docs);
    const docsTab = openTabOf(docs)!;
    const mail = browser.tabs.open({ url: 'https://example.com/mail', title: 'Mail' }).id!;
    await vi.waitFor(() => expect(todayTabs(sidebar.view())).toEqual(['Mail*']));

    await click(docs);

    expect(await stripOf(browser)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: [`${DOCS}*`, 'Mail'] }]);
    expect(openTabOf(docs)).toBe(docsTab);
    expect(pinnedTabs(sidebar.view())).toEqual(['Docs*']);
    expect((await browser.tabs.get(mail)).active).toBe(false);
  });

  it('opens Pinned tabs inside Folders too', async () => {
    const { browser, sidebar, home, click } = await startWithDocs();
    const projects = (await browser.bookmarks.create({ parentId: home.id, title: 'Projects' })).id;
    const board = await addPinnedTab(browser, home, 'Board', BOARD, projects);
    await vi.waitFor(() => expect(pinnedTabs(sidebar.view())).toEqual(['Docs (not open)', 'Board (not open)']));

    await click(board);

    expect(pinnedTabs(sidebar.view())).toEqual(['Docs (not open)', 'Board*']);
    expect(await stripOf(browser)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: [`${BOARD}*`] }]);
  });

  it('keeps the links between Pinned tabs and their tabs in session storage', async () => {
    const { browser, docs, click, openTabOf } = await startWithDocs();

    await click(docs);

    expect(await browser.storage.session.get(`pinnedTabs:${FAKE_WINDOW_ID}`)).toEqual({
      [`pinnedTabs:${FAKE_WINDOW_ID}`]: { [docs]: openTabOf(docs) },
    });
  });

  it('reports a Pinned tab that was removed in the meantime, and opens nothing', async () => {
    const { browser, sidebar, docs } = await startWithDocs();
    await browser.bookmarks.remove(docs);

    expect(await sidebar.run({ type: 'openPinnedTab', pinnedTabId: docs })).toEqual({ ok: false, reason: 'pinned-tab-not-found' });
    expect(await browser.tabs.query({})).toEqual([]);
  });

  it('opens a Pinned tab once the user drops a tab they were dragging', async () => {
    const { browser, sidebar, docs } = await startWithDocs();
    browser.tabs.dragging = true;

    const opening = sidebar.run({ type: 'openPinnedTab', pinnedTabId: docs });
    setTimeout(() => (browser.tabs.dragging = false), 300);

    expect(await opening).toEqual({ ok: true });
    expect(pinnedTabs(sidebar.view())).toEqual(['Docs*']);
  });
});

describe('pinning a Today tab', () => {
  it('adds a Pinned tab for the tab’s page where it’s dropped, and the tab becomes its open tab', async () => {
    const { browser, sidebar, home, openTab } = await startWithDocs();
    await openTab('Mail');
    const report = await openTab('Report');

    const outcome = await sidebar.run({ type: 'pinTab', tabId: report, toIndex: 0 });

    expect(outcome).toEqual({ ok: true });
    expect(browser.bookmarks.shape(home.id)).toEqual([
      { title: 'Report', url: 'https://example.com/report' },
      { title: 'Docs', url: DOCS },
    ]);
    expect(pinnedTabs(sidebar.view())).toEqual(['Report*', 'Docs (not open)']);
    expect(todayTabs(sidebar.view())).toEqual(['Mail']);
    expect(await stripOf(browser)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: ['Mail', 'Report*'] }]);
    const reportPinnedTab = sidebar.view().spaces[0]!.items[0]!.id;
    expect(sidebar.view().openPinnedTabs[reportPinnedTab]?.tabId).toBe(report);
  });

  it('adds a tab pinned from its menu after the Space’s Pinned tabs and Folders', async () => {
    const { browser, sidebar, home, openTab } = await startWithDocs();
    await browser.bookmarks.create({ parentId: home.id, title: 'Projects' });
    const mail = await openTab('Mail');

    expect(await sidebar.run({ type: 'pinTab', tabId: mail })).toEqual({ ok: true });

    expect(browser.bookmarks.shape(home.id)).toEqual([
      { title: 'Docs', url: DOCS },
      { title: 'Projects', children: [] },
      { title: 'Mail', url: 'https://example.com/mail' },
    ]);
    expect(pinnedTabs(sidebar.view())).toEqual(['Docs (not open)', 'Mail*']);
    expect(todayTabs(sidebar.view())).toEqual([]);
  });

  it('pins only the Active Space’s Today tabs', async () => {
    const { browser, sidebar, home, docs, click, openTabOf } = await startWithDocs();
    await click(docs);
    const chromePinned = browser.tabs.open({ url: 'https://example.com/music', title: 'Music', pinned: true }).id!;
    const before = browser.bookmarks.shape(home.id);

    for (const tabId of [openTabOf(docs)!, chromePinned, 999]) {
      expect(await sidebar.run({ type: 'pinTab', tabId })).toEqual({ ok: false, reason: 'failed' });
    }
    expect(browser.bookmarks.shape(home.id)).toEqual(before);
  });
});

describe('Pinned tabs in two windows', () => {
  it('keeps each window’s own open tab for a Pinned tab', async () => {
    const { browser, sidebar, docs, click, openTabOf } = await startWithDocs();
    const other = browser.windows.open();
    const otherSidebar = openSidebar(browser, other);
    await click(docs);
    await vi.waitFor(() => expect(pinnedTabs(otherSidebar.view())).toEqual(['Docs (not open)']));

    await click(docs, otherSidebar);
    await click(docs);

    expect(await stripOf(browser)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: [`${DOCS}*`] }]);
    expect(await stripOf(browser, other)).toEqual([{ group: 'Home', color: 'grey', collapsed: false, tabs: [`${DOCS}*`] }]);
    expect(openTabOf(docs)).not.toBe(openTabOf(docs, otherSidebar));
    expect(pinnedTabs(sidebar.view())).toEqual(['Docs*']);
    expect(pinnedTabs(otherSidebar.view())).toEqual(['Docs*']);
  });

  it('unlinks a Pinned tab’s tab dragged into another window, where it’s a Today tab', async () => {
    const { browser, sidebar, docs, click, openTabOf } = await startWithDocs();
    const other = browser.windows.open();
    const otherSidebar = openSidebar(browser, other);
    await click(docs);
    const docsTab = openTabOf(docs)!;

    browser.tabs.dragToWindow(docsTab, other);

    await vi.waitFor(() => expect(pinnedTabs(sidebar.view())).toEqual(['Docs (not open)']));
    await vi.waitFor(() => expect(todayTabs(otherSidebar.view())).toEqual([`${DOCS}*`]));
    expect(pinnedTabs(otherSidebar.view())).toEqual(['Docs (not open)']);
    await vi.waitFor(async () => expect(await browser.storage.session.get(`pinnedTabs:${FAKE_WINDOW_ID}`)).toEqual({}));
  });

  it('forgets a window’s links when the window closes', async () => {
    const { browser, docs, click } = await startWithDocs();
    const other = browser.windows.open();
    const otherSidebar = openSidebar(browser, other);
    await click(docs, otherSidebar);
    otherSidebar.close();

    browser.windows.close(other);

    await vi.waitFor(async () => expect(await browser.storage.session.get(`pinnedTabs:${other}`)).toEqual({}));
  });
});

describe('wandered Pinned tabs', () => {
  it('marks a Pinned tab whose tab browsed away as wandered, and takes the tab back to the Pinned URL', async () => {
    const { browser, sidebar, docs, click, openTabOf, openTab } = await startWithDocs();
    await click(docs);
    const docsTab = openTabOf(docs)!;
    browser.tabs.navigate(docsTab, { url: 'https://docs.example.com/drafts', title: 'Drafts' });
    await openTab('Mail');
    await vi.waitFor(() => expect(pinnedTabs(sidebar.view())).toEqual(['Docs (wandered: Drafts)']));

    expect(await sidebar.run({ type: 'returnToPinnedUrl', pinnedTabId: docs })).toEqual({ ok: true });

    expect(pinnedTabs(sidebar.view())).toEqual(['Docs*']);
    expect((await browser.tabs.get(docsTab)).url).toBe(DOCS);
    expect(sidebar.view().spaces[0]!.items[0]).toMatchObject({ pinnedUrl: DOCS });
  });

  it('doesn’t mark a tab still loading the Pinned URL as wandered', async () => {
    const { browser, sidebar, docs, click, openTabOf } = await startWithDocs();
    await click(docs);

    browser.tabs.navigate(openTabOf(docs)!, { url: '', title: '' });

    await vi.waitFor(() => expect(sidebar.view().openPinnedTabs[docs]?.url).toBe(''));
    expect(pinnedTabs(sidebar.view())).toEqual(['Docs*']);
  });
});

describe('closing and unpinning', () => {
  it('keeps a Pinned tab when its tab closes, shown as not open, and opens a new tab on the next click', async () => {
    const { browser, sidebar, docs, click, openTabOf } = await startWithDocs();
    await click(docs);
    const first = openTabOf(docs)!;

    browser.tabs.close(first);

    await vi.waitFor(() => expect(pinnedTabs(sidebar.view())).toEqual(['Docs (not open)']));
    await vi.waitFor(async () => expect(await browser.storage.session.get(`pinnedTabs:${FAKE_WINDOW_ID}`)).toEqual({}));
    await click(docs);
    expect(pinnedTabs(sidebar.view())).toEqual(['Docs*']);
    expect(openTabOf(docs)).not.toBe(first);
  });

  it('turns an open Pinned tab’s tab into a Today tab when it’s unpinned', async () => {
    const { browser, sidebar, home, docs, click, openTabOf } = await startWithDocs();
    await click(docs);
    const docsTab = openTabOf(docs)!;

    expect(await sidebar.run({ type: 'unpin', pinnedTabId: docs })).toEqual({ ok: true });

    expect(browser.bookmarks.shape(home.id)).toEqual([]);
    expect(pinnedTabs(sidebar.view())).toEqual([]);
    expect(sidebar.view().todayTabs).toEqual([{ id: docsTab, title: DOCS, url: DOCS, active: true }]);
    expect(await browser.storage.session.get(`pinnedTabs:${FAKE_WINDOW_ID}`)).toEqual({});
  });

  it('turns a Pinned tab’s tab into a Today tab when the Pinned tab is removed in the bookmark manager', async () => {
    const { browser, sidebar, docs, click } = await startWithDocs();
    await click(docs);

    await browser.bookmarks.remove(docs);

    await vi.waitFor(() => expect(todayTabs(sidebar.view())).toEqual([`${DOCS}*`]));
  });

  it('treats a Pinned tab’s tab that joined another Space as that Space’s Today tab', async () => {
    const { browser, sidebar, home, docs, click, openTabOf, createSpace } = await startWithDocs();
    await click(docs);
    const docsTab = openTabOf(docs)!;
    const work = await createSpace('Work', 'blue');
    await sidebar.switchTo(work.id);

    // Dragged out of Home's group, the tab joins Work, the Active Space, from the left.
    browser.tabs.dragOutOfGroup(docsTab);
    await vi.waitFor(() => expect(todayTabs(sidebar.view())).toEqual([DOCS, 'New Tab*']));
    await sidebar.switchTo(home.id);

    expect(pinnedTabs(sidebar.view())).toEqual(['Docs (not open)']);
    await click(docs);
    expect(openTabOf(docs)).not.toBe(docsTab);
  });
});
