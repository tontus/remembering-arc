import { describe, expect, it, vi } from 'vitest';
import { createFakeBrowser, type FakeBrowser } from '../browser/fake/fake-browser';
import type { BookmarkTreeSpec } from '../browser/fake/fake-bookmarks';
import { createLibrary, type Library, ROOT_FOLDER_NAME } from './library';
import type { LibraryStructure } from './structure';

const homeSpace = { id: expect.any(String), name: 'Home', icon: null, items: [] };

function syncingOtherBookmarks(browser: FakeBrowser): string {
  return browser.bookmarks.permanentFolderId('other', { syncing: true });
}

function localOtherBookmarks(browser: FakeBrowser): string {
  return browser.bookmarks.permanentFolderId('other', { local: true });
}

/** Adds a root folder with the given contents and returns its ID. */
async function addRoot(browser: FakeBrowser, parentId: string, children: BookmarkTreeSpec[]): Promise<string> {
  const [rootId] = await browser.bookmarks.addTree(parentId, [{ title: ROOT_FOLDER_NAME, children }]);
  return rootId!;
}

/** Subscribes and records every structure the Library sends. */
function record(library: Library): { structures: LibraryStructure[]; latest(): LibraryStructure | undefined } {
  const structures: LibraryStructure[] = [];
  library.subscribe((structure) => structures.push(structure));
  return { structures, latest: () => structures.at(-1) };
}

describe('finding the root folder', () => {
  it('creates the root with a Home Space in the syncing "Other bookmarks" when there is none', async () => {
    const browser = createFakeBrowser({ bookmarkSync: 'account' });

    const structure = await createLibrary(browser).read();

    expect(structure).toEqual({ syncing: true, favorites: [], spaces: [homeSpace] });
    expect(browser.bookmarks.shape(syncingOtherBookmarks(browser))).toEqual([
      { title: ROOT_FOLDER_NAME, children: [{ title: 'Home', children: [] }] },
    ]);
    expect(browser.bookmarks.shape(localOtherBookmarks(browser))).toEqual([]);
  });

  it('finds an existing root by name and changes nothing', async () => {
    const browser = createFakeBrowser({ bookmarkSync: 'account' });
    const other = syncingOtherBookmarks(browser);
    await browser.bookmarks.addTree(other, [{ title: 'Recipes', url: 'https://example.com/recipes' }]);
    await addRoot(browser, other, [{ title: '💼 Work', children: [] }]);
    const before = browser.bookmarks.shape(other);

    const structure = await createLibrary(browser).read();

    expect(structure.spaces).toEqual([{ id: expect.any(String), name: '💼 Work', icon: '💼', items: [] }]);
    expect(browser.bookmarks.shape(other)).toEqual(before);
  });

  it('looks only in the syncing tree when Chrome holds a local and an account tree', async () => {
    const browser = createFakeBrowser({ bookmarkSync: 'account' });
    await addRoot(browser, localOtherBookmarks(browser), [{ title: 'Local Space', children: [] }]);

    const structure = await createLibrary(browser).read();

    expect(structure).toEqual({ syncing: true, favorites: [], spaces: [homeSpace] });
    expect(browser.bookmarks.shape(localOtherBookmarks(browser))).toEqual([
      { title: ROOT_FOLDER_NAME, children: [{ title: 'Local Space', children: [] }] },
    ]);
  });

  it('uses the local "Other bookmarks" and reports not syncing when no tree syncs', async () => {
    const browser = createFakeBrowser({ bookmarkSync: 'off' });

    const structure = await createLibrary(browser).read();

    expect(structure).toEqual({ syncing: false, favorites: [], spaces: [homeSpace] });
    expect(browser.bookmarks.shape(localOtherBookmarks(browser))).toEqual([
      { title: ROOT_FOLDER_NAME, children: [{ title: 'Home', children: [] }] },
    ]);
  });

  it('reports syncing when the local tree syncs through Chrome’s older full sync', async () => {
    const browser = createFakeBrowser({ bookmarkSync: 'legacy' });

    const structure = await createLibrary(browser).read();

    expect(structure.syncing).toBe(true);
    expect(browser.bookmarks.shape(localOtherBookmarks(browser))).toEqual([
      { title: ROOT_FOLDER_NAME, children: [{ title: 'Home', children: [] }] },
    ]);
  });

  it('adds a Home Space to a root that has no Spaces, after its Favorites', async () => {
    const browser = createFakeBrowser();
    const rootId = await addRoot(browser, syncingOtherBookmarks(browser), [
      { title: 'Mail', url: 'https://mail.example.com/' },
    ]);

    const structure = await createLibrary(browser).read();

    expect(structure.spaces).toEqual([homeSpace]);
    expect(structure.favorites).toEqual([{ id: expect.any(String), title: 'Mail', url: 'https://mail.example.com/' }]);
    expect(browser.bookmarks.shape(rootId)).toEqual([
      { title: 'Mail', url: 'https://mail.example.com/' },
      { title: 'Home', children: [] },
    ]);
  });

  it('does not mistake a bookmark with the root folder’s name for the root', async () => {
    const browser = createFakeBrowser();
    const other = syncingOtherBookmarks(browser);
    await browser.bookmarks.addTree(other, [{ title: ROOT_FOLDER_NAME, url: 'https://example.com/' }]);

    await createLibrary(browser).read();

    expect(browser.bookmarks.shape(other)).toEqual([
      { title: ROOT_FOLDER_NAME, url: 'https://example.com/' },
      { title: ROOT_FOLDER_NAME, children: [{ title: 'Home', children: [] }] },
    ]);
  });

  it('creates a single root when several reads start at once', async () => {
    const browser = createFakeBrowser();
    const library = createLibrary(browser);

    await Promise.all([library.read(), library.read(), library.read()]);

    expect(browser.bookmarks.shape(syncingOtherBookmarks(browser))).toEqual([
      { title: ROOT_FOLDER_NAME, children: [{ title: 'Home', children: [] }] },
    ]);
  });
});

describe('reading the tree', () => {
  it('reads Favorites, Spaces, Pinned tabs and Folders at any depth, in bookmark order', async () => {
    const browser = createFakeBrowser();
    await addRoot(browser, syncingOtherBookmarks(browser), [
      { title: 'Mail', url: 'https://mail.example.com/' },
      {
        title: '🏠 Personal',
        children: [
          { title: 'Bank', url: 'https://bank.example.com/' },
          {
            title: 'Trips',
            children: [
              { title: 'Flights', url: 'https://flights.example.com/' },
              { title: '2027', children: [{ title: 'Hotel', url: 'https://hotel.example.com/' }] },
              { title: 'Empty', children: [] },
            ],
          },
          { title: 'News', url: 'https://news.example.com/' },
        ],
      },
      { title: 'Calendar', url: 'https://calendar.example.com/' },
      { title: 'Work', children: [] },
    ]);

    const structure = await createLibrary(browser).read();

    const id = expect.any(String);
    expect(structure).toEqual({
      syncing: true,
      favorites: [
        { id, title: 'Mail', url: 'https://mail.example.com/' },
        { id, title: 'Calendar', url: 'https://calendar.example.com/' },
      ],
      spaces: [
        {
          id,
          name: '🏠 Personal',
          icon: '🏠',
          items: [
            { kind: 'pinnedTab', id, title: 'Bank', pinnedUrl: 'https://bank.example.com/' },
            {
              kind: 'folder',
              id,
              name: 'Trips',
              items: [
                { kind: 'pinnedTab', id, title: 'Flights', pinnedUrl: 'https://flights.example.com/' },
                {
                  kind: 'folder',
                  id,
                  name: '2027',
                  items: [{ kind: 'pinnedTab', id, title: 'Hotel', pinnedUrl: 'https://hotel.example.com/' }],
                },
                { kind: 'folder', id, name: 'Empty', items: [] },
              ],
            },
            { kind: 'pinnedTab', id, title: 'News', pinnedUrl: 'https://news.example.com/' },
          ],
        },
        { id, name: 'Work', icon: null, items: [] },
      ],
    });
  });
});

describe('reacting to bookmark changes', () => {
  async function setUp() {
    const browser = createFakeBrowser();
    const rootId = await addRoot(browser, syncingOtherBookmarks(browser), [
      { title: '💼 Work', children: [{ title: 'Docs', url: 'https://docs.example.com/' }] },
      { title: '🏠 Personal', children: [] },
    ]);
    const library = createLibrary(browser);
    const recording = record(library);
    await vi.waitFor(() => expect(recording.latest()).toBeDefined());
    const [work, personal] = recording.latest()!.spaces;
    return { browser, library, rootId, work: work!, personal: personal!, ...recording };
  }

  it('sends the structure to a new subscriber', async () => {
    const { latest } = await setUp();

    expect(latest()?.spaces.map((space) => space.name)).toEqual(['💼 Work', '🏠 Personal']);
  });

  it('sends a fresh structure when a Pinned tab is added in the bookmark manager', async () => {
    const { browser, personal, latest } = await setUp();

    await browser.bookmarks.create({ parentId: personal.id, title: 'Bank', url: 'https://bank.example.com/' });

    await vi.waitFor(() =>
      expect(latest()?.spaces[1]?.items).toEqual([
        { kind: 'pinnedTab', id: expect.any(String), title: 'Bank', pinnedUrl: 'https://bank.example.com/' },
      ]),
    );
  });

  it('follows renames, moves, removals and sorting', async () => {
    const { browser, rootId, work, personal, latest } = await setUp();
    const names = () => latest()?.spaces.map((space) => space.name);

    await browser.bookmarks.update(work.id, { title: '🚀 Launch' });
    await vi.waitFor(() => expect(names()).toEqual(['🚀 Launch', '🏠 Personal']));
    expect(latest()?.spaces[0]?.icon).toBe('🚀');

    await browser.bookmarks.move(work.items[0]!.id, { parentId: personal.id });
    await vi.waitFor(() => expect(latest()?.spaces[1]?.items.map((item) => item.id)).toEqual([work.items[0]!.id]));
    expect(latest()?.spaces[0]?.items).toEqual([]);

    browser.bookmarks.reorderChildren(rootId, [personal.id, work.id]);
    await vi.waitFor(() => expect(names()).toEqual(['🏠 Personal', '🚀 Launch']));

    await browser.bookmarks.removeTree(personal.id);
    await vi.waitFor(() => expect(names()).toEqual(['🚀 Launch']));
  });

  it('adds a Home Space when the last Space is removed', async () => {
    const { browser, rootId, work, personal, latest } = await setUp();

    await browser.bookmarks.removeTree(work.id);
    await browser.bookmarks.removeTree(personal.id);

    await vi.waitFor(() => expect(latest()?.spaces).toEqual([homeSpace]));
    expect(browser.bookmarks.shape(rootId)).toEqual([{ title: 'Home', children: [] }]);
  });

  it('recreates the root with a Home Space when the root is removed', async () => {
    const { browser, rootId, latest } = await setUp();

    await browser.bookmarks.removeTree(rootId);

    await vi.waitFor(() => expect(latest()?.spaces).toEqual([homeSpace]));
    expect(browser.bookmarks.shape(syncingOtherBookmarks(browser))).toEqual([
      { title: ROOT_FOLDER_NAME, children: [{ title: 'Home', children: [] }] },
    ]);
  });

  it('sends nothing when a change leaves the structure as it was', async () => {
    const { browser, library, structures } = await setUp();
    const count = structures.length;

    const barId = browser.bookmarks.permanentFolderId('bookmarks-bar', { syncing: true });
    await browser.bookmarks.create({ parentId: barId, title: 'Elsewhere', url: 'https://example.com/' });
    await library.read();

    expect(structures).toHaveLength(count);
  });

  it('stops sending after unsubscribing', async () => {
    const browser = createFakeBrowser();
    const library = createLibrary(browser);
    const listener = vi.fn();
    const unsubscribe = library.subscribe(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    unsubscribe();
    const { spaces } = await library.read();
    await browser.bookmarks.update(spaces[0]!.id, { title: 'Renamed' });
    await library.read();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
