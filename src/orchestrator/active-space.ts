import type { StorageAreaPort } from '../browser/port';
import type { LibraryStructure, Space } from '../library/structure';

/**
 * Each window's Active Space lives in session extension storage, under one key per window,
 * as a Space ID. Chrome clears session storage when the browser restarts, as it does the
 * window IDs.
 */
const KEY_PREFIX = 'activeSpace:';

export function activeSpaceKey(windowId: number): string {
  return KEY_PREFIX + windowId;
}

/** The window an Active Space key belongs to, or undefined if it isn't one. */
export function windowOfActiveSpaceKey(key: string): number | undefined {
  const match = /^activeSpace:(\d+)$/.exec(key);
  return match ? Number(match[1]) : undefined;
}

/** The ID of the Space stored as the window's Active Space, if any. It may have been deleted since. */
export async function readActiveSpaceId(session: StorageAreaPort, windowId: number): Promise<string | undefined> {
  const key = activeSpaceKey(windowId);
  const { [key]: spaceId } = await session.get(key);
  return typeof spaceId === 'string' ? spaceId : undefined;
}

export async function writeActiveSpaceId(session: StorageAreaPort, windowId: number, spaceId: string): Promise<void> {
  await session.set({ [activeSpaceKey(windowId)]: spaceId });
}

export async function forgetActiveSpace(session: StorageAreaPort, windowId: number): Promise<void> {
  await session.remove(activeSpaceKey(windowId));
}

/**
 * The Space a window shows: the one stored for it, or the first Space when none is stored or
 * the stored one is gone. The Library always has at least one Space.
 */
export function resolveActiveSpace(structure: LibraryStructure, storedId: string | undefined): Space {
  const space = structure.spaces.find((each) => each.id === storedId) ?? structure.spaces[0];
  if (!space) throw new Error('The Library has no Spaces.');
  return space;
}
