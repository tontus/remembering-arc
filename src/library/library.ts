import type { BookmarkNode, BrowserPort } from '../browser/port';
import { getMessage } from '../i18n';
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
}

interface Subscriber {
  listener: (structure: LibraryStructure) => void;
  onError?: (error: unknown) => void;
}

export function createLibrary(browser: Pick<BrowserPort, 'bookmarks' | 'i18n'>): Library {
  const { bookmarks } = browser;

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

  async function readOrCreate(): Promise<LibraryStructure> {
    for (let attempt = 1; ; attempt++) {
      const { otherBookmarks, root } = await findRoot();
      if (root?.children?.some(isFolderNode)) return parseRoot(root, otherBookmarks.syncing);
      if (attempt > 1) throw new Error('The root folder changed while its Home Space was being created.');

      const rootId = root?.id ?? (await bookmarks.create({ parentId: otherBookmarks.id, title: ROOT_FOLDER_NAME })).id;
      await bookmarks.create({ parentId: rootId, title: getMessage(browser.i18n, 'homeSpaceName') });
    }
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

  // Refreshes run one at a time, so two can't both create a root. A request made while a
  // refresh is waiting to start joins it: that refresh hasn't read the tree yet.
  let queue: Promise<unknown> = Promise.resolve();
  let waiting: Promise<LibraryStructure> | undefined;
  function refresh(): Promise<LibraryStructure> {
    if (waiting) return waiting;
    const run = queue.then(() => {
      waiting = undefined;
      return refreshNow();
    });
    waiting = run;
    queue = run.catch(() => {});
    return run;
  }

  // Chrome fires these for every change: the extension's own, the bookmark manager's, and
  // sync's. Re-reading the whole tree is simple and catches changes to the root itself.
  const onBookmarksChanged = () => {
    if (subscribers.size > 0) refresh().catch(() => {});
  };
  bookmarks.onCreated.addListener(onBookmarksChanged);
  bookmarks.onRemoved.addListener(onBookmarksChanged);
  bookmarks.onChanged.addListener(onBookmarksChanged);
  bookmarks.onMoved.addListener(onBookmarksChanged);
  bookmarks.onChildrenReordered.addListener(onBookmarksChanged);

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
  };
}
