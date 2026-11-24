import { describe, expect, it, vi } from 'vitest';
import type { BookmarkNode, BrowserEvent } from '../port';
import { createFakeBrowser } from './fake-browser';

/** Resolves with the arguments of the event's next dispatch. */
function nextCall<Listener extends (...args: never[]) => void>(
  event: BrowserEvent<Listener>,
): Promise<Parameters<Listener>> {
  return new Promise((resolve) => {
    const listener = ((...args: Parameters<Listener>) => {
      event.removeListener(listener);
      resolve(args);
    }) as Listener;
    event.addListener(listener);
  });
}

function permanentFolders(tree: BookmarkNode[]) {
  return tree[0]!.children!.map(({ title, folderType, syncing }) => ({ title, folderType, syncing }));
}

describe('fake bookmarks', () => {
  it('holds one local tree that does not sync when the profile is signed out', async () => {
    const { bookmarks } = createFakeBrowser({ bookmarkSync: 'off' });

    expect(permanentFolders(await bookmarks.getTree())).toEqual([
      { title: 'Bookmarks bar', folderType: 'bookmarks-bar', syncing: false },
      { title: 'Other bookmarks', folderType: 'other', syncing: false },
      { title: 'Mobile bookmarks', folderType: 'mobile', syncing: false },
    ]);
  });

  it('holds a local tree and a syncing account tree when signed in with account storage', async () => {
    const { bookmarks } = createFakeBrowser({ bookmarkSync: 'account' });

    expect(permanentFolders(await bookmarks.getTree())).toEqual([
      { title: 'Bookmarks bar', folderType: 'bookmarks-bar', syncing: false },
      { title: 'Other bookmarks', folderType: 'other', syncing: false },
      { title: 'Mobile bookmarks', folderType: 'mobile', syncing: false },
      { title: 'Bookmarks bar', folderType: 'bookmarks-bar', syncing: true },
      { title: 'Other bookmarks', folderType: 'other', syncing: true },
      { title: 'Mobile bookmarks', folderType: 'mobile', syncing: true },
    ]);
  });

  it('syncs the single local tree under Chrome’s older full sync', async () => {
    const { bookmarks } = createFakeBrowser({ bookmarkSync: 'legacy' });

    expect(permanentFolders(await bookmarks.getTree()).map((folder) => folder.syncing)).toEqual([true, true, true]);
  });

  it('gives each node its tree’s syncing flag, which changes when the node moves to the other tree', async () => {
    const { bookmarks } = createFakeBrowser({ bookmarkSync: 'account' });
    const local = bookmarks.permanentFolderId('other', { local: true });
    const account = bookmarks.permanentFolderId('other', { syncing: true });
    const folder = await bookmarks.create({ parentId: local, title: 'Folder' });
    await bookmarks.create({ parentId: folder.id, title: 'Page', url: 'https://example.com/' });
    const syncingOf = async (title: string) => {
      const find = (nodes: BookmarkNode[]): BookmarkNode | undefined =>
        nodes.map((node) => (node.title === title ? node : find(node.children ?? []))).find(Boolean);
      return find(await bookmarks.getTree())?.syncing;
    };
    expect(await syncingOf('Page')).toBe(false);

    await bookmarks.move(folder.id, { parentId: account });

    expect(await syncingOf('Folder')).toBe(true);
    expect(await syncingOf('Page')).toBe(true);
  });

  it('fires Chrome’s events with Chrome’s payloads', async () => {
    const { bookmarks } = createFakeBrowser();
    const other = bookmarks.permanentFolderId('other', { syncing: true });

    const created = nextCall(bookmarks.onCreated);
    const folder = await bookmarks.create({ parentId: other, title: 'Folder' });
    expect(await created).toEqual([folder.id, expect.objectContaining({ id: folder.id, parentId: other, index: 0 })]);

    const page = await bookmarks.create({ parentId: other, title: 'Page', url: 'https://example.com/' });
    const changed = nextCall(bookmarks.onChanged);
    await bookmarks.update(page.id, { title: 'Renamed', url: 'https://example.org/' });
    expect(await changed).toEqual([page.id, { title: 'Renamed', url: 'https://example.org/' }]);

    const moved = nextCall(bookmarks.onMoved);
    await bookmarks.move(page.id, { parentId: folder.id });
    expect(await moved).toEqual([page.id, { parentId: folder.id, index: 0, oldParentId: other, oldIndex: 1 }]);

    const removed = nextCall(bookmarks.onRemoved);
    await bookmarks.removeTree(folder.id);
    expect(await removed).toEqual([
      folder.id,
      {
        parentId: other,
        index: 0,
        node: expect.objectContaining({ id: folder.id, children: [expect.objectContaining({ id: page.id })] }),
      },
    ]);
  });

  it('fires events after the call that caused them, never during it', async () => {
    const { bookmarks } = createFakeBrowser();
    const listener = vi.fn();
    bookmarks.onCreated.addListener(listener);

    const creating = bookmarks.create({ title: 'Page', url: 'https://example.com/' });

    expect(listener).not.toHaveBeenCalled();
    await creating;
    expect(listener).toHaveBeenCalledOnce();
  });

  it('lands a node moved later within its folder one place earlier, as Chrome does', async () => {
    const { bookmarks } = createFakeBrowser();
    const other = bookmarks.permanentFolderId('other', { syncing: true });
    const [a, , c] = await bookmarks.addTree(other, [
      { title: 'a', url: 'https://a.example/' },
      { title: 'b', url: 'https://b.example/' },
      { title: 'c', url: 'https://c.example/' },
    ]);

    const moved = await bookmarks.move(a!, { index: 2 });

    expect(moved.index).toBe(1);
    expect(bookmarks.shape(other).map((node) => node.title)).toEqual(['b', 'a', 'c']);
    await bookmarks.move(c!, { index: 0 });
    expect(bookmarks.shape(other).map((node) => node.title)).toEqual(['c', 'b', 'a']);
  });

  it('refuses what Chrome refuses', async () => {
    const { bookmarks } = createFakeBrowser();
    const other = bookmarks.permanentFolderId('other', { syncing: true });
    const folder = await bookmarks.create({ parentId: other, title: 'Folder' });
    const child = await bookmarks.create({ parentId: folder.id, title: 'Child' });

    await expect(bookmarks.create({ parentId: '0', title: 'x' })).rejects.toThrow("Can't modify the root bookmark folders.");
    await expect(bookmarks.update(other, { title: 'x' })).rejects.toThrow("Can't modify the root bookmark folders.");
    await expect(bookmarks.remove(other)).rejects.toThrow("Can't modify the root bookmark folders.");
    await expect(bookmarks.remove(folder.id)).rejects.toThrow("Can't remove non-empty folder");
    await expect(bookmarks.update(folder.id, { url: 'https://example.com/' })).rejects.toThrow(
      "Can't set URL of a bookmark folder.",
    );
    await expect(bookmarks.move(folder.id, { parentId: child.id })).rejects.toThrow("Can't move a folder into itself");
    await expect(bookmarks.create({ parentId: other, index: 5 })).rejects.toThrow('Index out of bounds.');
    await expect(bookmarks.create({ parentId: other, url: 'not a url' })).rejects.toThrow('Invalid URL.');
    await expect(bookmarks.update('missing', { title: 'x' })).rejects.toThrow("Can't find bookmark for id.");
    await expect(bookmarks.create({ parentId: 'missing' })).rejects.toThrow("Can't find parent bookmark for id.");
  });

  it('sorts a folder as the bookmark manager does, firing onChildrenReordered', async () => {
    const { bookmarks } = createFakeBrowser();
    const other = bookmarks.permanentFolderId('other', { syncing: true });
    const [b, a] = await bookmarks.addTree(other, [
      { title: 'b', url: 'https://b.example/' },
      { title: 'a', url: 'https://a.example/' },
    ]);

    const reordered = nextCall(bookmarks.onChildrenReordered);
    bookmarks.reorderChildren(other, [a!, b!]);

    expect(await reordered).toEqual([other, { childIds: [a, b] }]);
    expect(bookmarks.shape(other).map((node) => node.title)).toEqual(['a', 'b']);
  });
});

describe('fake storage', () => {
  it('stores JSON copies and reports only values that changed', async () => {
    const { storage } = createFakeBrowser();
    const value = { list: [1, 2] };
    const changes = nextCall(storage.local.onChanged);

    await storage.local.set({ a: value, b: 'same' });
    value.list.push(3);

    expect(await changes).toEqual([{ a: { newValue: { list: [1, 2] } }, b: { newValue: 'same' } }]);
    expect(await storage.local.get('a')).toEqual({ a: { list: [1, 2] } });

    const next = nextCall(storage.local.onChanged);
    await storage.local.set({ a: { list: [1] }, b: 'same' });
    expect(await next).toEqual([{ a: { oldValue: { list: [1, 2] }, newValue: { list: [1] } } }]);

    await storage.local.remove('b');
    expect(await storage.local.get(null)).toEqual({ a: { list: [1] } });
  });

  it('keeps sync, local and session storage apart', async () => {
    const { storage } = createFakeBrowser();

    await storage.sync.set({ key: 'synced' });
    await storage.session.set({ key: 'session' });

    expect(await storage.sync.get('key')).toEqual({ key: 'synced' });
    expect(await storage.local.get('key')).toEqual({});
    expect(await storage.session.get(['key'])).toEqual({ key: 'session' });
  });
});

describe('fake runtime', () => {
  it('connects to onConnect listeners and passes JSON-serialized messages both ways', async () => {
    const { runtime } = createFakeBrowser();
    const connected = nextCall(runtime.onConnect);

    const sidebar = runtime.connect({ name: 'sidebar' });
    const [core] = await connected;
    expect(core.name).toBe('sidebar');

    const toCore = nextCall(core.onMessage);
    sidebar.postMessage({ when: new Date(0), skipped: undefined });
    expect(await toCore).toEqual([{ when: '1970-01-01T00:00:00.000Z' }]);

    const toSidebar = nextCall(sidebar.onMessage);
    core.postMessage('hello');
    expect(await toSidebar).toEqual(['hello']);
  });

  it('tells only the other end when a port disconnects', async () => {
    const { runtime } = createFakeBrowser();
    const connected = nextCall(runtime.onConnect);
    const sidebar = runtime.connect({ name: 'sidebar' });
    const [core] = await connected;
    const sidebarDisconnected = vi.fn();
    sidebar.onDisconnect.addListener(sidebarDisconnected);

    const coreDisconnected = nextCall(core.onDisconnect);
    sidebar.disconnect();

    await coreDisconnected;
    expect(sidebarDisconnected).not.toHaveBeenCalled();
    expect(() => core.postMessage('late')).toThrow('disconnected port');
  });

  it('drops a connection nobody listens for', async () => {
    const { runtime } = createFakeBrowser();

    const port = runtime.connect({ name: 'sidebar' });

    await nextCall(port.onDisconnect);
  });

  it('drops every connection when the service worker stops', async () => {
    const { runtime } = createFakeBrowser();
    const connected = nextCall(runtime.onConnect);
    const sidebar = runtime.connect({ name: 'sidebar' });
    const [core] = await connected;

    const bothDisconnected = Promise.all([nextCall(sidebar.onDisconnect), nextCall(core.onDisconnect)]);
    runtime.disconnectAll();

    await bothDisconnected;
  });
});

describe('fake i18n', () => {
  it('reads English messages from the extension’s messages.json', () => {
    const { i18n } = createFakeBrowser();

    expect(i18n.getMessage('homeSpaceName')).toBe('Home');
    expect(i18n.getMessage('noSuchMessage')).toBe('');
  });
});

describe('fake user gestures', () => {
  it('lets the side panel open and permissions be asked for only during a user gesture', async () => {
    const browser = createFakeBrowser();

    await expect(browser.sidePanel.open({ windowId: 1 })).rejects.toThrow('user gesture');
    await expect(browser.permissions.request({ origins: ['<all_urls>'] })).rejects.toThrow('user gesture');
    await browser.withUserGesture(() => browser.sidePanel.open({ windowId: 1 }));

    expect(browser.sidePanel.isOpen(1)).toBe(true);
  });

  it('ends the gesture at the first await, as in the service worker', async () => {
    const browser = createFakeBrowser();

    const late = browser.withUserGesture(async () => {
      await browser.storage.local.get();
      return browser.sidePanel.open({ windowId: 1 });
    });

    await expect(late).rejects.toThrow('user gesture');
  });

  it('runs shortcut listeners inside the key press’s gesture', async () => {
    const browser = createFakeBrowser();
    const tab = browser.tabs.open({ url: 'https://example.com/' });
    const opened = new Promise<void>((resolve, reject) => {
      browser.commands.onCommand.addListener((_command, pressedIn) => {
        browser.sidePanel.open({ windowId: pressedIn!.windowId }).then(resolve, reject);
      });
    });

    browser.commands.press('toggle-sidebar-mode', tab);

    await opened;
    expect(browser.sidePanel.isOpen(tab.windowId)).toBe(true);
  });
});

describe('fake permissions', () => {
  it('asks the user only for missing optional host permissions the manifest declares', async () => {
    const { permissions, withUserGesture } = createFakeBrowser();
    const added = nextCall(permissions.onAdded);

    permissions.promptAnswer = 'deny';
    expect(await withUserGesture(() => permissions.request({ origins: ['<all_urls>'] }))).toBe(false);
    permissions.promptAnswer = 'allow';
    expect(await withUserGesture(() => permissions.request({ origins: ['<all_urls>'] }))).toBe(true);
    expect(await withUserGesture(() => permissions.request({ origins: ['<all_urls>'] }))).toBe(true);

    expect(permissions.promptCount).toBe(2);
    expect(await added).toEqual([{ origins: ['<all_urls>'], permissions: [] }]);
    expect(await permissions.contains({ origins: ['<all_urls>'] })).toBe(true);
    await expect(withUserGesture(() => permissions.request({ origins: ['https://example.com/*'] }))).rejects.toThrow(
      'Only permissions specified in the manifest may be requested.',
    );
  });

  it('fires onRemoved when the user takes access away', async () => {
    const { permissions } = createFakeBrowser();
    permissions.grant(['<all_urls>']);
    const removed = nextCall(permissions.onRemoved);

    permissions.revoke(['<all_urls>']);

    expect(await removed).toEqual([{ origins: ['<all_urls>'], permissions: [] }]);
    expect(await permissions.contains({ origins: ['<all_urls>'] })).toBe(false);
  });
});

describe('fake tabs and scripting', () => {
  const script = { id: 'overlay', js: ['overlay.js'], matches: ['<all_urls>'] };

  it('shows a tab’s URL only where the extension has host access', async () => {
    const { tabs, permissions } = createFakeBrowser();
    tabs.open({ url: 'https://example.com/' });

    expect((await tabs.query({}))[0]!.url).toBeUndefined();
    permissions.grant(['<all_urls>']);
    expect((await tabs.query({}))[0]!.url).toBe('https://example.com/');
  });

  it('refuses duplicate and unknown script IDs, as Chrome does', async () => {
    const { scripting } = createFakeBrowser();
    await scripting.registerContentScripts([script]);

    await expect(scripting.registerContentScripts([script])).rejects.toThrow("Duplicate script ID 'overlay'");
    await scripting.unregisterContentScripts({ ids: ['overlay'] });
    await expect(scripting.unregisterContentScripts({ ids: ['overlay'] })).rejects.toThrow("Nonexistent script ID 'overlay'");
  });

  it('runs registered scripts in pages that load later, only where content scripts can run with host access', async () => {
    const { scripting, tabs, permissions } = createFakeBrowser();
    await scripting.registerContentScripts([script]);
    const early = tabs.open({ url: 'https://example.com/' });
    permissions.grant(['<all_urls>']);

    const page = tabs.open({ url: 'https://example.org/' });
    const newTab = tabs.open({ url: 'chrome://newtab/' });
    const webStore = tabs.open({ url: 'https://chromewebstore.google.com/' });

    expect(scripting.injectedFiles(early.id!)).toEqual([]);
    expect(scripting.injectedFiles(page.id!)).toEqual(['overlay.js']);
    expect(scripting.injectedFiles(newTab.id!)).toEqual([]);
    expect(scripting.injectedFiles(webStore.id!)).toEqual([]);
  });

  it('runs a script in an open page on request, and refuses pages where content scripts can’t run', async () => {
    const { scripting, tabs, permissions } = createFakeBrowser();
    const page = tabs.open({ url: 'https://example.com/' });
    const newTab = tabs.open({ url: 'chrome://newtab/' });

    await expect(scripting.executeScript({ target: { tabId: page.id! }, files: ['a.js'] })).rejects.toThrow(
      'Cannot access contents of the page',
    );
    permissions.grant(['<all_urls>']);
    await scripting.executeScript({ target: { tabId: page.id! }, files: ['a.js'] });
    await expect(scripting.executeScript({ target: { tabId: newTab.id! }, files: ['a.js'] })).rejects.toThrow(
      'Cannot access a chrome:// URL',
    );

    expect(scripting.injectedFiles(page.id!)).toEqual(['a.js']);
  });
});
