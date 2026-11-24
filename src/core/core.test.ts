import { describe, expect, it, vi } from 'vitest';
import { createFakeBrowser } from '../browser/fake/fake-browser';
import { connectToCore, type CoreUpdate } from '../sidebar/connect-to-core';
import { startCore } from './core';
import type { SidebarView } from './sidebar-protocol';

/** Connects a sidebar to the core and records what it receives. */
function openSidebar(browser: ReturnType<typeof createFakeBrowser>) {
  const messages: CoreUpdate[] = [];
  const { run, close } = connectToCore(browser, (message) => messages.push(message));
  const latestView = (): SidebarView | undefined =>
    messages.findLast((message) => message.type === 'view')?.view;
  return { messages, latestView, run, close };
}

describe('the core', () => {
  it('makes the toolbar icon open the Docked sidebar in the side panel', async () => {
    const browser = createFakeBrowser();

    startCore(browser);

    await vi.waitFor(() => expect(browser.sidePanel.panelBehavior).toEqual({ openPanelOnActionClick: true }));
  });

  it('sends a sidebar its view, then a fresh one after each bookmark change', async () => {
    const browser = createFakeBrowser();
    startCore(browser);

    const sidebar = openSidebar(browser);

    await vi.waitFor(() => expect(sidebar.latestView()?.spaces.map((space) => space.name)).toEqual(['Home']));
    const home = sidebar.latestView()!.spaces[0]!;
    await browser.bookmarks.create({ parentId: home.id, title: 'Docs', url: 'https://docs.example.com/' });
    await vi.waitFor(() =>
      expect(sidebar.latestView()?.spaces[0]?.items).toEqual([
        { kind: 'pinnedTab', id: expect.any(String), title: 'Docs', pinnedUrl: 'https://docs.example.com/' },
      ]),
    );
  });

  it('tells the sidebar when bookmarks are not syncing', async () => {
    const browser = createFakeBrowser({ bookmarkSync: 'off' });
    startCore(browser);

    const sidebar = openSidebar(browser);

    await vi.waitFor(() => expect(sidebar.latestView()?.syncing).toBe(false));
  });

  it('keeps a sidebar up to date after Chrome stops the idle service worker', async () => {
    const browser = createFakeBrowser();
    startCore(browser);
    const sidebar = openSidebar(browser);
    await vi.waitFor(() => expect(sidebar.latestView()).toBeDefined());

    browser.runtime.disconnectAll();
    await browser.bookmarks.update(sidebar.latestView()!.spaces[0]!.id, { title: '🌱 Fresh start' });

    await vi.waitFor(() => expect(sidebar.latestView()?.spaces[0]?.name).toBe('🌱 Fresh start'));
  });

  it('tells the sidebar when the Library cannot be read', async () => {
    const browser = createFakeBrowser();
    browser.bookmarks.getTree = async () => {
      throw new Error('Bookmarks are unavailable');
    };
    startCore(browser);

    const sidebar = openSidebar(browser);

    await vi.waitFor(() => expect(sidebar.messages).toContainEqual({ type: 'error', message: 'Bookmarks are unavailable' }));
  });

  it('stops sending to a sidebar once it closes', async () => {
    const browser = createFakeBrowser();
    startCore(browser);
    const sidebar = openSidebar(browser);
    await vi.waitFor(() => expect(sidebar.latestView()).toBeDefined());
    const count = sidebar.messages.length;

    sidebar.close();
    await browser.bookmarks.update(sidebar.latestView()!.spaces[0]!.id, { title: 'Renamed' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sidebar.messages).toHaveLength(count);
  });
});

describe('commands from the sidebar', () => {
  async function setUp() {
    const browser = createFakeBrowser();
    startCore(browser);
    const sidebar = openSidebar(browser);
    await vi.waitFor(() => expect(sidebar.latestView()).toBeDefined());
    return { browser, sidebar };
  }

  it('runs a command, and sends the view that shows it before saying it worked', async () => {
    const { sidebar } = await setUp();

    const outcome = await sidebar.run({ type: 'createSpace', icon: '🚀', label: 'Launch', color: 'blue' });

    expect(outcome).toEqual({ ok: true, spaceId: expect.any(String) });
    expect(sidebar.latestView()?.spaces.at(-1)).toMatchObject({
      id: outcome.ok ? outcome.spaceId : undefined,
      name: '🚀 Launch',
      color: 'blue',
    });
  });

  it('runs each kind of Space command', async () => {
    const { sidebar } = await setUp();
    const created = await sidebar.run({ type: 'createSpace', icon: null, label: 'Work', color: 'grey' });
    const spaceId = created.ok ? created.spaceId! : '';

    expect(await sidebar.run({ type: 'renameSpace', spaceId, label: 'Office' })).toEqual({ ok: true });
    expect(await sidebar.run({ type: 'setSpaceIcon', spaceId, icon: '💼' })).toEqual({ ok: true });
    expect(await sidebar.run({ type: 'setSpaceColor', spaceId, color: 'cyan' })).toEqual({ ok: true });
    expect(await sidebar.run({ type: 'moveSpace', spaceId, toIndex: 0 })).toEqual({ ok: true });

    expect(sidebar.latestView()?.spaces.map(({ name, color }) => ({ name, color }))).toEqual([
      { name: '💼 Office', color: 'cyan' },
      { name: 'Home', color: 'grey' },
    ]);
  });

  it('tells the sidebar why a command was turned down', async () => {
    const { sidebar } = await setUp();

    const outcome = await sidebar.run({ type: 'createSpace', icon: null, label: 'Home', color: 'red' });

    expect(outcome).toEqual({ ok: false, reason: 'duplicate-name', spaceName: 'Home' });
  });

  it('runs a command sent just after Chrome stops the idle service worker', async () => {
    const { browser, sidebar } = await setUp();

    browser.runtime.disconnectAll();
    const outcome = await sidebar.run({ type: 'createSpace', icon: '🚀', label: 'Launch', color: 'blue' });

    expect(outcome).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(sidebar.latestView()?.spaces.map((space) => space.name)).toEqual(['Home', '🚀 Launch']));
  });

  it('reports a command as failed when the connection drops before the reply', async () => {
    const { browser, sidebar } = await setUp();

    const outcome = sidebar.run({ type: 'createSpace', icon: '🚀', label: 'Launch', color: 'blue' });
    await Promise.resolve();
    browser.runtime.disconnectAll();

    expect(await outcome).toEqual({ ok: false, reason: 'failed' });
  });
});
