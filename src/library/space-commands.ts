import type { BookmarkNode, BookmarksPort, StorageAreaPort } from '../browser/port';
import { leadingEmoji } from './leading-emoji';
import { isSpaceColor, type SpaceColor, spaceColorKey } from './space-color';
import { isSpaceIcon, spaceLabel, spaceName } from './space-name';
import { isFolderNode } from './structure';

/** Why the Library turned down a command. The sidebar shows the user a message for each. */
export type LibraryErrorReason =
  /** Another Space already has the name. `spaceName` is that name. */
  | 'duplicate-name'
  /** The name, without its icon, is empty. */
  | 'empty-name'
  /** The icon isn't exactly one emoji. */
  | 'invalid-icon'
  /** The color isn't one of Chrome's tab group colors. */
  | 'invalid-color'
  /** The Space is gone, for example deleted on another device. */
  | 'space-not-found';

/** A command the Library turned down without writing anything. */
export class LibraryCommandError extends Error {
  readonly reason: LibraryErrorReason;
  readonly spaceName: string | undefined;

  constructor(reason: LibraryErrorReason, spaceName?: string) {
    super(spaceName === undefined ? `Space command refused: ${reason}` : `Space command refused: ${reason} (${spaceName})`);
    this.name = 'LibraryCommandError';
    this.reason = reason;
    this.spaceName = spaceName;
  }
}

export interface NewSpace {
  /** The emoji the name starts with, or null for none. */
  icon: string | null;
  /** The name after the icon. */
  label: string;
  color: SpaceColor;
}

/** What the Space commands work on. `root` is the root folder, read with its children just before. */
export interface SpaceCommandContext {
  bookmarks: BookmarksPort;
  sync: StorageAreaPort;
  root: BookmarkNode;
}

/** Adds a Space after the others and returns its ID. */
export async function createSpace({ bookmarks, sync, root }: SpaceCommandContext, space: NewSpace): Promise<string> {
  const name = checkedName(space.icon, space.label);
  checkColor(space.color);
  checkUnique(root, name);

  // The color goes first, so the new Space never shows another color, even briefly.
  const colorKey = spaceColorKey(name);
  await sync.set({ [colorKey]: space.color });
  try {
    return (await bookmarks.create({ parentId: root.id, title: name })).id;
  } catch (error) {
    await sync.remove(colorKey).catch(() => {});
    throw error;
  }
}

/** Renames a Space, keeping its icon and color. */
export async function renameSpace(context: SpaceCommandContext, spaceId: string, label: string): Promise<void> {
  const space = findSpace(context.root, spaceId);
  await retitle(context, space, checkedName(leadingEmoji(space.title), label));
}

/** Gives a Space a new icon, or none when `icon` is null, keeping its color. */
export async function setSpaceIcon(context: SpaceCommandContext, spaceId: string, icon: string | null): Promise<void> {
  const space = findSpace(context.root, spaceId);
  await retitle(context, space, checkedName(icon, spaceLabel(space.title)));
}

export async function setSpaceColor({ sync, root }: SpaceCommandContext, spaceId: string, color: SpaceColor): Promise<void> {
  checkColor(color);
  const space = findSpace(root, spaceId);
  await sync.set({ [spaceColorKey(space.title)]: color });
}

/**
 * Moves a Space to `toIndex` among the Spaces. Favorites sit in the same folder, so they keep
 * their own order.
 */
export async function moveSpace({ bookmarks, root }: SpaceCommandContext, spaceId: string, toIndex: number): Promise<void> {
  if (!Number.isInteger(toIndex)) throw new TypeError(`Not a position: ${toIndex}`);
  const space = findSpace(root, spaceId);
  const spaces = root.children!.filter(isFolderNode);
  const others = spaces.filter((other) => other.id !== spaceId);
  const target = Math.min(Math.max(toIndex, 0), others.length);
  if (spaces.indexOf(space) === target) return;

  // Chrome takes the index in the folder as it is before the Space leaves it.
  const before = others[target];
  await bookmarks.move(space.id, { parentId: root.id, index: before?.index ?? root.children!.length });
}

/** The Space's new name, or a refusal if it's empty or its icon isn't an emoji. */
function checkedName(icon: string | null, label: string): string {
  const trimmedIcon = icon?.trim() ?? null;
  if (trimmedIcon !== null && !isSpaceIcon(trimmedIcon)) throw new LibraryCommandError('invalid-icon');
  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  if (trimmedLabel === '') throw new LibraryCommandError('empty-name');
  return spaceName(trimmedIcon, trimmedLabel);
}

function checkColor(color: unknown): void {
  if (!isSpaceColor(color)) throw new LibraryCommandError('invalid-color');
}

/** Space names are unique, because a tab group belongs to a Space by name (ADR-0002). */
function checkUnique(root: BookmarkNode, name: string, spaceId?: string): void {
  const taken = root.children!.some((node) => isFolderNode(node) && node.title === name && node.id !== spaceId);
  if (taken) throw new LibraryCommandError('duplicate-name', name);
}

function findSpace(root: BookmarkNode, spaceId: string): BookmarkNode {
  const space = root.children!.find((node) => node.id === spaceId && isFolderNode(node));
  if (!space) throw new LibraryCommandError('space-not-found');
  return space;
}

/**
 * Renames a Space's folder and moves its color to the new name. A rename made anywhere else
 * leaves the color behind, so the Space shows the default color.
 */
async function retitle({ bookmarks, sync, root }: SpaceCommandContext, space: BookmarkNode, name: string): Promise<void> {
  if (name === space.title) return;
  checkUnique(root, name, space.id);

  const oldKey = spaceColorKey(space.title);
  const newKey = spaceColorKey(name);
  const color = (await sync.get(oldKey))[oldKey];
  // A color left under the new name by an old Space mustn't pass to this one.
  if (isSpaceColor(color)) await sync.set({ [newKey]: color });
  else await sync.remove(newKey);
  await bookmarks.update(space.id, { title: name });
  await sync.remove(oldKey);
}
