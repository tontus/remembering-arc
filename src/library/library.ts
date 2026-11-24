import type { BookmarkNode, BrowserPort } from '../browser/port';
import { getMessage } from '../i18n';
import { DEFAULT_SPACE_COLOR, isSpaceColor, isSpaceColorKey, type SpaceColor, spaceColorKey } from './space-color';
import {
  createSpace,
  moveSpace,
  type NewSpace,
  renameSpace,
  type SpaceCommandContext,
  setSpaceColor,
  setSpaceIcon,
} from './space-commands';
import { isFolderNode, type LibraryStructure, parseRoot } from './structure';

/**
 * The name of the root folder: the product name. It isn't translated, because every device
 * must look for the same folder.
 */
export const ROOT_FOLDER_NAME = 'Remembering Arc';

/** The Space structure stored in bookmarks (ADR-0001). */
export interface Library {
  /** Reads the Library, first creating the root folder or a "Home" Space if either is missing. */
  read(): Promise<LibraryStructure>;
  /**
   * Calls `listener` with the structure, then again after every bookmark change that alters
   * it, wherever the change came from. `onError` hears about reads that fail. Returns a
   * function that unsubscribes.
   */
  subscribe(listener: (structure: LibraryStructure) => void, onError?: (error: unknown) => void): () => void;

  // Commands write to bookmarks and synced storage straight away, so the change syncs to the
  // user's other devices. They run one at a time. A command the Library turns down throws a
  // `LibraryCommandError` and writes nothing.

  /** Adds a Space after the others and returns its ID. */
  createSpace(space: NewSpace): Promise<string>;
  /** Changes the name after a Space's icon. Its color moves to the new name. */
  renameSpace(spaceId: string, label: string): Promise<void>;
  /** Changes a Space's icon, or removes it when `icon` is null. Its color moves to the new name. */
  setSpaceIcon(spaceId: string, icon: string | null): Promise<void>;
  setSpaceColor(spaceId: string, color: SpaceColor): Promise<void>;
  /** Moves a Space to `toIndex` among the Spaces. */
  moveSpace(spaceId: string, toIndex: number): Promise<void>;
}

interface Subscriber {
  listener: (structure: LibraryStructure) => void;
  onError?: (error: unknown) => void;
}

export function createLibrary(browser: Pick<BrowserPort, 'bookmarks' | 'i18n' | 'storage'>): Library {
  const { bookmarks } = browser;
  const { sync } = browser.storage;

  /** Each subscriber, with the last structure it was sent. */
  const subscribers = new Map<Subscriber, LibraryStructure | undefined>();
  let current: LibraryStructure | undefined;
  let currentJson = '';

  async function findRoot(): Promise<{ otherBookmarks: BookmarkNode; root: BookmarkNode | undefined }> {
    const [tree] = await bookmarks.getTree();
    const candidates = (tree?.children ?? []).filter((node) => node.folderType === 'other');
    // Chrome may hold a local and an account "Other bookmarks". Only the account one syncs.
    const otherBookmarks = candidates.find((node) => node.syncing) ?? candidates[0];
    if (!otherBookmarks) throw new Error('Chrome reported no "Other bookmarks" folder.');
    const root = otherBookmarks.children?.find((node) => isFolderNode(node) && node.title === ROOT_FOLDER_NAME);
    return { otherBookmarks, root };
  }

  /** The root folder with its children, first creating it or a "Home" Space if either is missing. */
  async function ensureRoot(): Promise<{ root: BookmarkNode; syncing: boolean }> {
    for (let attempt = 1; ; attempt++) {
      const { otherBookmarks, root } = await findRoot();
      if (root?.children?.some(isFolderNode)) return { root, syncing: otherBookmarks.syncing };
      if (attempt > 1) throw new Error('The root folder changed while its Home Space was being created.');

      const rootId = root?.id ?? (await bookmarks.create({ parentId: otherBookmarks.id, title: ROOT_FOLDER_NAME })).id;
      await bookmarks.create({ parentId: rootId, title: getMessage(browser.i18n, 'homeSpaceName') });
    }
  }

  async function readOrCreate(): Promise<LibraryStructure> {
    const { root, syncing } = await ensureRoot();
    const keys = root.children!.filter(isFolderNode).map((space) => spaceColorKey(space.title));
    const colors = keys.length > 0 ? await sync.get(keys) : {};
    return parseRoot(root, syncing, (name) => {
      const color = colors[spaceColorKey(name)];
      return isSpaceColor(color) ? color : DEFAULT_SPACE_COLOR;
    });
  }

  async function refreshNow(): Promise<LibraryStructure> {
    let next: LibraryStructure;
    try {
      next = await readOrCreate();
    } catch (error) {
      for (const subscriber of subscribers.keys()) subscriber.onError?.(error);
      throw error;
    }

    const nextJson = JSON.stringify(next);
    if (nextJson !== currentJson) {
      current = next;
      currentJson = nextJson;
    }
    const structure = current!;
    for (const [subscriber, sent] of subscribers) {
      if (sent === structure) continue;
      subscribers.set(subscriber, structure);
      try {
        subscriber.listener(structure);
      } catch (error) {
        console.error('Error in a Library subscriber:', error);
      }
    }
    return structure;
  }

  // Refreshes and commands run one at a time, so two can't both create a root, and a command
  // checks names against the tree as it is. A refresh requested while one is waiting to start
  // joins it: that refresh hasn't read the tree yet.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  let waiting: Promise<LibraryStructure> | undefined;
  function refresh(): Promise<LibraryStructure> {
    if (waiting) return waiting;
    const run = enqueue(() => {
      waiting = undefined;
      return refreshNow();
    });
    waiting = run;
    return run;
  }

  function command<T>(run: (context: SpaceCommandContext) => Promise<T>): Promise<T> {
    return enqueue(async () => run({ bookmarks, sync, root: (await ensureRoot()).root }));
  }

  // Chrome fires these for every change: the extension's own, the bookmark manager's, and
  // sync's. Re-reading the whole tree is simple and catches changes to the root itself.
  const onLibraryChanged = () => {
    if (subscribers.size > 0) refresh().catch(() => {});
  };
  bookmarks.onCreated.addListener(onLibraryChanged);
  bookmarks.onRemoved.addListener(onLibraryChanged);
  bookmarks.onChanged.addListener(onLibraryChanged);
  bookmarks.onMoved.addListener(onLibraryChanged);
  bookmarks.onChildrenReordered.addListener(onLibraryChanged);
  // Space colors change here, and when another device's change arrives through sync.
  sync.onChanged.addListener((changes) => {
    if (Object.keys(changes).some(isSpaceColorKey)) onLibraryChanged();
  });

  return {
    read: refresh,
    subscribe(listener, onError) {
      const subscriber: Subscriber = { listener, onError };
      subscribers.set(subscriber, undefined);
      refresh().catch(() => {});
      return () => {
        subscribers.delete(subscriber);
      };
    },
    createSpace: (space) => command((context) => createSpace(context, space)),
    renameSpace: (spaceId, label) => command((context) => renameSpace(context, spaceId, label)),
    setSpaceIcon: (spaceId, icon) => command((context) => setSpaceIcon(context, spaceId, icon)),
    setSpaceColor: (spaceId, color) => command((context) => setSpaceColor(context, spaceId, color)),
    moveSpace: (spaceId, toIndex) => command((context) => moveSpace(context, spaceId, toIndex)),
  };
}
