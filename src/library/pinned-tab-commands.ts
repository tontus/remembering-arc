import type { BookmarkNode } from '../browser/port';
import { findSpace, LibraryCommandError, type SpaceCommandContext } from './space-commands';
import { isFolderNode } from './structure';

/** A page to keep in a Space as a Pinned tab. */
export interface NewPinnedTab {
  title: string;
  /** The Pinned URL: the address the Pinned tab opens and returns to. */
  url: string;
}

/**
 * Adds a Pinned tab to a Space, at `toIndex` among the Space's Pinned tabs and Folders, or
 * after them when `toIndex` is omitted. Returns the Pinned tab's ID.
 */
export async function createPinnedTab(
  { bookmarks, root }: SpaceCommandContext,
  spaceId: string,
  pinnedTab: NewPinnedTab,
  toIndex?: number,
): Promise<string> {
  const space = findSpace(root, spaceId);
  const url = typeof pinnedTab.url === 'string' ? pinnedTab.url.trim() : '';
  if (url === '') throw new TypeError('A Pinned tab needs a URL.');
  if (toIndex !== undefined && !Number.isInteger(toIndex)) throw new TypeError(`Not a position: ${toIndex}`);
  const count = space.children?.length ?? 0;
  const index = toIndex === undefined ? count : Math.min(Math.max(toIndex, 0), count);
  const title = typeof pinnedTab.title === 'string' ? pinnedTab.title : '';
  return (await bookmarks.create({ parentId: space.id, index, title, url })).id;
}

/** Removes a Pinned tab from its Space, wherever it is in the Space's Folders. */
export async function unpin({ bookmarks, root }: SpaceCommandContext, pinnedTabId: string): Promise<void> {
  const pinnedTab = root.children!.filter(isFolderNode).map((space) => findPinnedTabNode(space, pinnedTabId)).find(Boolean);
  if (!pinnedTab) throw new LibraryCommandError('pinned-tab-not-found');
  await bookmarks.remove(pinnedTab.id);
}

/** The bookmark of a Pinned tab inside a Space or Folder, at any depth. */
function findPinnedTabNode(folder: BookmarkNode, pinnedTabId: string): BookmarkNode | undefined {
  for (const node of folder.children ?? []) {
    if (!isFolderNode(node) && node.id === pinnedTabId) return node;
    if (isFolderNode(node)) {
      const found = findPinnedTabNode(node, pinnedTabId);
      if (found) return found;
    }
  }
  return undefined;
}
