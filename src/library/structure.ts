import type { BookmarkNode } from '../browser/port';
import { leadingEmoji } from './leading-emoji';
import type { SpaceColor } from './space-color';
import { spaceLabel } from './space-name';

/**
 * The Spaces, Pinned tabs, Folders and Favorites stored under the root folder (ADR-0001).
 * IDs are bookmark IDs, which are different on each device.
 */
export interface LibraryStructure {
  /** False when the root folder is in a bookmark tree that doesn't sync to the user's account. */
  syncing: boolean;
  /** Bookmarks directly in the root folder, in bookmark order. */
  favorites: Favorite[];
  /** Subfolders of the root folder, in bookmark order. */
  spaces: Space[];
}

export interface Favorite {
  id: string;
  title: string;
  url: string;
}

export interface Space {
  id: string;
  /** The full folder title, icon included. */
  name: string;
  /** The emoji the folder title starts with, if any. */
  icon: string | null;
  /** The name after the icon: the part the user types. */
  label: string;
  /** One of Chrome's tab group colors, from synced extension storage. */
  color: SpaceColor;
  /** The Space's Pinned tabs and Folders, in bookmark order. */
  items: SpaceItem[];
}

export type SpaceItem = PinnedTab | Folder;

export interface PinnedTab {
  kind: 'pinnedTab';
  id: string;
  title: string;
  pinnedUrl: string;
}

export interface Folder {
  kind: 'folder';
  id: string;
  name: string;
  /** Pinned tabs and Folders inside this Folder, in bookmark order. */
  items: SpaceItem[];
}

export function isFolderNode(node: BookmarkNode): boolean {
  return node.url === undefined;
}

/**
 * Reads a root folder, as returned with its children by `getTree()`. `colorOf` gives each
 * Space's color from its name.
 */
export function parseRoot(
  root: BookmarkNode,
  syncing: boolean,
  colorOf: (spaceName: string) => SpaceColor,
): LibraryStructure {
  const favorites: Favorite[] = [];
  const spaces: Space[] = [];
  for (const node of root.children ?? []) {
    if (node.url === undefined) {
      spaces.push({
        id: node.id,
        name: node.title,
        icon: leadingEmoji(node.title),
        label: spaceLabel(node.title),
        color: colorOf(node.title),
        items: parseItems(node),
      });
    } else {
      favorites.push({ id: node.id, title: node.title, url: node.url });
    }
  }
  return { syncing, favorites, spaces };
}

function parseItems(folder: BookmarkNode): SpaceItem[] {
  return (folder.children ?? []).map((node) =>
    node.url === undefined
      ? { kind: 'folder', id: node.id, name: node.title, items: parseItems(node) }
      : { kind: 'pinnedTab', id: node.id, title: node.title, pinnedUrl: node.url },
  );
}
