import { describe, expect, it, vi } from 'vitest';
import { createFakeBrowser, type FakeBrowser } from '../browser/fake/fake-browser';
import type { BookmarkTreeSpec } from '../browser/fake/fake-bookmarks';
import { createLibrary, type Library, ROOT_FOLDER_NAME } from './library';
import type { SpaceColor } from './space-color';
import type { LibraryStructure } from './structure';

const homeSpace = { id: expect.any(String), name: 'Home', icon: null, label: 'Home', color: 'grey', items: [] };

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

    expect(structure.spaces).toEqual([
      { id: expect.any(String), name: '💼 Work', icon: '💼', label: 'Work', color: 'grey', items: [] },
    ]);
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
          label: 'Personal',
          color: 'grey',
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
        { id, name: 'Work', icon: null, label: 'Work', color: 'grey', items: [] },
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

/** Sets up a root holding `children`, plus a Library with a recorded subscription. */
async function setUpLibrary(children: BookmarkTreeSpec[], colors: Record<string, string> = {}) {
  const browser = createFakeBrowser();
  const rootId = await addRoot(browser, syncingOtherBookmarks(browser), children);
  await browser.storage.sync.set(colors);
  const library = createLibrary(browser);
  const recording = record(library);
  await vi.waitFor(() => expect(recording.latest()).toBeDefined());
  const spaceId = (name: string) => recording.latest()!.spaces.find((space) => space.name === name)!.id;
  /** Expects a command to be turned down, and nothing to be written. */
  const expectRefused = async (command: Promise<unknown>, refusal: { reason: string; spaceName?: string }) => {
    const tree = browser.bookmarks.shape(rootId);
    const stored = await browser.storage.sync.get();
    await expect(command).rejects.toMatchObject(refusal);
    expect(browser.bookmarks.shape(rootId)).toEqual(tree);
    expect(await browser.storage.sync.get()).toEqual(stored);
  };
  return { browser, rootId, library, spaceId, expectRefused, ...recording };
}

const mail = { title: 'Mail', url: 'https://mail.example.com/' };
const calendar = { title: 'Calendar', url: 'https://calendar.example.com/' };

describe('Space colors', () => {
  it('shows each Space’s color from synced storage, and the default color where none is stored', async () => {
    const { latest } = await setUpLibrary(
      [
        { title: '💼 Work', children: [] },
        { title: '🏠 Personal', children: [] },
      ],
      { 'spaceColor:💼 Work': 'blue' },
    );

    expect(latest()?.spaces.map((space) => space.color)).toEqual(['blue', 'grey']);
  });

  it('follows a color changed on another device', async () => {
    const { browser, latest } = await setUpLibrary([{ title: '💼 Work', children: [] }], { 'spaceColor:💼 Work': 'blue' });

    await browser.storage.sync.set({ 'spaceColor:💼 Work': 'green' });

    await vi.waitFor(() => expect(latest()?.spaces[0]?.color).toBe('green'));
  });

  it('shows the default color for a stored value that isn’t a tab group color', async () => {
    const { latest } = await setUpLibrary([{ title: '💼 Work', children: [] }], { 'spaceColor:💼 Work': 'black' });

    expect(latest()?.spaces[0]?.color).toBe('grey');
  });

  it('shows the default color for a Space renamed outside the extension', async () => {
    const { browser, spaceId, latest } = await setUpLibrary([{ title: '💼 Work', children: [] }], {
      'spaceColor:💼 Work': 'blue',
    });

    // As in Chrome's bookmark manager.
    await browser.bookmarks.update(spaceId('💼 Work'), { title: '💼 Office' });

    await vi.waitFor(() => expect(latest()?.spaces[0]).toMatchObject({ name: '💼 Office', color: 'grey' }));
  });
});

describe('creating a Space', () => {
  const children = [mail, { title: '🏠 Home', children: [] }];

  it('adds a folder named with the icon and name after the other Spaces, and stores its color', async () => {
    const { browser, rootId, library, latest } = await setUpLibrary(children);

    const spaceId = await library.createSpace({ icon: '🚀', label: 'Launch', color: 'blue' });

    expect(browser.bookmarks.shape(rootId)).toEqual([
      mail,
      { title: '🏠 Home', children: [] },
      { title: '🚀 Launch', children: [] },
    ]);
    expect(await browser.storage.sync.get()).toEqual({ 'spaceColor:🚀 Launch': 'blue' });
    await vi.waitFor(() =>
      expect(latest()?.spaces.at(-1)).toEqual({
        id: spaceId,
        name: '🚀 Launch',
        icon: '🚀',
        label: 'Launch',
        color: 'blue',
        items: [],
      }),
    );
  });

  it('names a Space without an icon with its trimmed name alone', async () => {
    const { browser, rootId, library } = await setUpLibrary(children);

    await library.createSpace({ icon: null, label: '  Reading list ', color: 'grey' });

    expect(browser.bookmarks.shape(rootId).at(-1)).toEqual({ title: 'Reading list', children: [] });
    expect(await browser.storage.sync.get()).toEqual({ 'spaceColor:Reading list': 'grey' });
  });

  it('turns down a name another Space already has', async () => {
    const { library, expectRefused } = await setUpLibrary(children);

    await expectRefused(library.createSpace({ icon: '🏠', label: 'Home', color: 'red' }), {
      reason: 'duplicate-name',
      spaceName: '🏠 Home',
    });
  });

  it('turns down an empty name', async () => {
    const { library, expectRefused } = await setUpLibrary(children);

    await expectRefused(library.createSpace({ icon: '🚀', label: '   ', color: 'blue' }), { reason: 'empty-name' });
  });

  it.each(['A', '🚀🚀', '🚀 Launch'])('turns down the icon %j, which isn’t one emoji', async (icon) => {
    const { library, expectRefused } = await setUpLibrary(children);

    await expectRefused(library.createSpace({ icon, label: 'Launch', color: 'blue' }), { reason: 'invalid-icon' });
  });

  it('turns down a color that isn’t a tab group color', async () => {
    const { library, expectRefused } = await setUpLibrary(children);

    await expectRefused(library.createSpace({ icon: '🚀', label: 'Launch', color: 'black' as SpaceColor }), {
      reason: 'invalid-color',
    });
  });

  it('creates one Space when two with the same name are created at once', async () => {
    const { browser, rootId, library } = await setUpLibrary(children);

    const results = await Promise.allSettled([
      library.createSpace({ icon: '🚀', label: 'Launch', color: 'blue' }),
      library.createSpace({ icon: '🚀', label: 'Launch', color: 'red' }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(browser.bookmarks.shape(rootId).map((node) => node.title)).toEqual(['Mail', '🏠 Home', '🚀 Launch']);
    expect(await browser.storage.sync.get()).toEqual({ 'spaceColor:🚀 Launch': 'blue' });
  });
});

describe('renaming a Space', () => {
  const children = [
    { title: '💼 Work', children: [{ title: 'Docs', url: 'https://docs.example.com/' }] },
    { title: '🏠 Personal', children: [] },
  ];

  it('changes the name after the icon and takes the color to the new name', async () => {
    const { browser, rootId, library, spaceId, latest } = await setUpLibrary(children, { 'spaceColor:💼 Work': 'blue' });

    await library.renameSpace(spaceId('💼 Work'), ' Office ');

    expect(browser.bookmarks.shape(rootId)).toEqual([
      { title: '💼 Office', children: [{ title: 'Docs', url: 'https://docs.example.com/' }] },
      { title: '🏠 Personal', children: [] },
    ]);
    expect(await browser.storage.sync.get()).toEqual({ 'spaceColor:💼 Office': 'blue' });
    await vi.waitFor(() =>
      expect(latest()?.spaces[0]).toMatchObject({ name: '💼 Office', label: 'Office', color: 'blue' }),
    );
  });

  it('keeps the default color, even where an old Space left a color under the new name', async () => {
    const { browser, library, spaceId, latest } = await setUpLibrary(children, { 'spaceColor:💼 Office': 'red' });

    await library.renameSpace(spaceId('💼 Work'), 'Office');

    expect(await browser.storage.sync.get()).toEqual({});
    await vi.waitFor(() => expect(latest()?.spaces[0]).toMatchObject({ name: '💼 Office', color: 'grey' }));
  });

  it('turns down a name another Space already has', async () => {
    const { library, spaceId, expectRefused } = await setUpLibrary([
      { title: '💼 Work', children: [] },
      { title: '💼 Office', children: [] },
    ]);

    await expectRefused(library.renameSpace(spaceId('💼 Work'), 'Office'), {
      reason: 'duplicate-name',
      spaceName: '💼 Office',
    });
  });

  it('turns down an empty name', async () => {
    const { library, spaceId, expectRefused } = await setUpLibrary(children, { 'spaceColor:💼 Work': 'blue' });

    await expectRefused(library.renameSpace(spaceId('💼 Work'), ''), { reason: 'empty-name' });
  });

  it('changes nothing when the name stays the same', async () => {
    const { browser, rootId, library, spaceId } = await setUpLibrary(children, { 'spaceColor:💼 Work': 'blue' });

    await library.renameSpace(spaceId('💼 Work'), 'Work');

    expect(browser.bookmarks.shape(rootId)[0]?.title).toBe('💼 Work');
    expect(await browser.storage.sync.get()).toEqual({ 'spaceColor:💼 Work': 'blue' });
  });

  it('reports a Space that’s gone, for example deleted on another device', async () => {
    const { browser, library, spaceId } = await setUpLibrary(children);
    const workId = spaceId('💼 Work');
    await browser.bookmarks.removeTree(workId);

    await expect(library.renameSpace(workId, 'Office')).rejects.toMatchObject({ reason: 'space-not-found' });
  });
});

describe('changing a Space’s icon', () => {
  it('replaces the emoji the name starts with, and takes the color to the new name', async () => {
    const { browser, rootId, library, spaceId, latest } = await setUpLibrary([{ title: '💼 Work', children: [] }], {
      'spaceColor:💼 Work': 'blue',
    });

    await library.setSpaceIcon(spaceId('💼 Work'), '👩🏽‍💻');

    expect(browser.bookmarks.shape(rootId)).toEqual([{ title: '👩🏽‍💻 Work', children: [] }]);
    expect(await browser.storage.sync.get()).toEqual({ 'spaceColor:👩🏽‍💻 Work': 'blue' });
    await vi.waitFor(() => expect(latest()?.spaces[0]).toMatchObject({ icon: '👩🏽‍💻', label: 'Work', color: 'blue' }));
  });

  it('adds an icon to a Space that has none', async () => {
    const { browser, rootId, library, spaceId } = await setUpLibrary([{ title: 'Reading', children: [] }]);

    await library.setSpaceIcon(spaceId('Reading'), '📚');

    expect(browser.bookmarks.shape(rootId)).toEqual([{ title: '📚 Reading', children: [] }]);
  });

  it('removes the icon', async () => {
    const { browser, rootId, library, spaceId } = await setUpLibrary([{ title: '💼Work', children: [] }], {
      'spaceColor:💼Work': 'red',
    });

    await library.setSpaceIcon(spaceId('💼Work'), null);

    expect(browser.bookmarks.shape(rootId)).toEqual([{ title: 'Work', children: [] }]);
    expect(await browser.storage.sync.get()).toEqual({ 'spaceColor:Work': 'red' });
  });

  it('turns down an icon that would give the Space another Space’s name', async () => {
    const { library, spaceId, expectRefused } = await setUpLibrary([
      { title: '💼 Work', children: [] },
      { title: '🏠 Work', children: [] },
    ]);

    await expectRefused(library.setSpaceIcon(spaceId('💼 Work'), '🏠'), { reason: 'duplicate-name', spaceName: '🏠 Work' });
  });

  it('turns down an icon that isn’t one emoji', async () => {
    const { library, spaceId, expectRefused } = await setUpLibrary([{ title: '💼 Work', children: [] }]);

    await expectRefused(library.setSpaceIcon(spaceId('💼 Work'), 'W'), { reason: 'invalid-icon' });
  });
});

describe('setting a Space’s color', () => {
  it('stores the color in synced storage under the Space’s name', async () => {
    const { browser, library, spaceId, latest } = await setUpLibrary([{ title: '💼 Work', children: [] }]);

    await library.setSpaceColor(spaceId('💼 Work'), 'purple');

    expect(await browser.storage.sync.get()).toEqual({ 'spaceColor:💼 Work': 'purple' });
    await vi.waitFor(() => expect(latest()?.spaces[0]?.color).toBe('purple'));
  });

  it('turns down a color that isn’t a tab group color', async () => {
    const { library, spaceId, expectRefused } = await setUpLibrary([{ title: '💼 Work', children: [] }]);

    await expectRefused(library.setSpaceColor(spaceId('💼 Work'), 'black' as SpaceColor), { reason: 'invalid-color' });
  });
});

describe('reordering Spaces', () => {
  const titles = (browser: FakeBrowser, rootId: string) => browser.bookmarks.shape(rootId).map((node) => node.title);

  it('moves a Space among the Spaces, leaving the Favorites in their order', async () => {
    const { browser, rootId, library, spaceId, latest } = await setUpLibrary([
      mail,
      { title: 'A', children: [] },
      { title: 'B', children: [] },
      calendar,
      { title: 'C', children: [] },
    ]);

    await library.moveSpace(spaceId('C'), 0);
    expect(titles(browser, rootId)).toEqual(['Mail', 'C', 'A', 'B', 'Calendar']);

    await library.moveSpace(spaceId('A'), 2);
    expect(titles(browser, rootId)).toEqual(['Mail', 'C', 'B', 'Calendar', 'A']);

    await library.moveSpace(spaceId('A'), 1);
    expect(titles(browser, rootId)).toEqual(['Mail', 'C', 'A', 'B', 'Calendar']);
    await vi.waitFor(() => expect(latest()?.spaces.map((space) => space.name)).toEqual(['C', 'A', 'B']));
    expect(latest()?.favorites.map((favorite) => favorite.title)).toEqual(['Mail', 'Calendar']);
  });

  it('changes nothing when a Space is dropped where it already is', async () => {
    const { browser, rootId, library, spaceId } = await setUpLibrary([{ title: 'A', children: [] }, mail, { title: 'B', children: [] }]);

    await library.moveSpace(spaceId('A'), 0);

    expect(titles(browser, rootId)).toEqual(['A', 'Mail', 'B']);
  });

  it('moves a Space given a position past the end to the end', async () => {
    const { browser, rootId, library, spaceId } = await setUpLibrary([
      { title: 'A', children: [] },
      { title: 'B', children: [] },
    ]);

    await library.moveSpace(spaceId('A'), 99);

    expect(titles(browser, rootId)).toEqual(['B', 'A']);
  });
});

describe('Pinned tabs', () => {
  const docs = { title: 'Docs', url: 'https://docs.example.com/' };
  const board = { title: 'Board', url: 'https://board.example.com/' };

  it('adds a Pinned tab to a Space at a position, or after its Pinned tabs and Folders', async () => {
    const { browser, rootId, library, spaceId, latest } = await setUpLibrary([
      { title: 'Work', children: [docs, { title: 'Projects', children: [] }] },
      { title: 'Personal', children: [] },
    ]);

    const first = await library.createPinnedTab(spaceId('Work'), { title: 'Mail', url: 'https://mail.example.com/' }, 0);
    await library.createPinnedTab(spaceId('Work'), { title: 'Board', url: 'https://board.example.com/' });

    expect(browser.bookmarks.shape(rootId)).toEqual([
      {
        title: 'Work',
        children: [
          { title: 'Mail', url: 'https://mail.example.com/' },
          docs,
          { title: 'Projects', children: [] },
          { title: 'Board', url: 'https://board.example.com/' },
        ],
      },
      { title: 'Personal', children: [] },
    ]);
    await vi.waitFor(() =>
      expect(latest()?.spaces[0]?.items[0]).toEqual({
        kind: 'pinnedTab',
        id: first,
        title: 'Mail',
        pinnedUrl: 'https://mail.example.com/',
      }),
    );
  });

  it('adds a Pinned tab given a position past the end after the others', async () => {
    const { browser, rootId, library, spaceId } = await setUpLibrary([{ title: 'Work', children: [docs] }]);

    await library.createPinnedTab(spaceId('Work'), board, 99);

    expect(browser.bookmarks.shape(rootId)).toEqual([{ title: 'Work', children: [docs, board] }]);
  });

  it('reports a Space that’s gone when pinning to it', async () => {
    const { browser, library, spaceId, expectRefused } = await setUpLibrary([
      { title: 'Work', children: [] },
      { title: 'Personal', children: [] },
    ]);
    const workId = spaceId('Work');
    await browser.bookmarks.removeTree(workId);

    await expectRefused(library.createPinnedTab(workId, board), { reason: 'space-not-found' });
  });

  it('unpins a Pinned tab, including one inside a Folder', async () => {
    const { browser, rootId, library, latest } = await setUpLibrary([
      { title: 'Work', children: [docs, { title: 'Projects', children: [board] }] },
    ]);
    const work = latest()!.spaces[0]!;
    const projects = work.items[1]!;
    if (projects.kind !== 'folder') throw new Error('Expected a Folder.');

    await library.unpin(work.items[0]!.id);
    await library.unpin(projects.items[0]!.id);

    expect(browser.bookmarks.shape(rootId)).toEqual([{ title: 'Work', children: [{ title: 'Projects', children: [] }] }]);
  });

  it('turns down unpinning a Favorite or a Pinned tab that’s gone', async () => {
    const { library, latest, expectRefused } = await setUpLibrary([mail, { title: 'Work', children: [docs] }]);
    const favoriteId = latest()!.favorites[0]!.id;
    const pinnedTabId = latest()!.spaces[0]!.items[0]!.id;
    await library.unpin(pinnedTabId);

    await expectRefused(library.unpin(favoriteId), { reason: 'pinned-tab-not-found' });
    await expectRefused(library.unpin(pinnedTabId), { reason: 'pinned-tab-not-found' });
  });
});
