import type { SpaceColor } from '../library/space-color';
import type { LibraryErrorReason } from '../library/space-commands';
import type { LibraryStructure } from '../library/structure';

/** The name of the connection an open sidebar makes to the core, which says the sidebar's window. */
export function sidebarPortName(windowId: number): string {
  return `sidebar/${windowId}`;
}

/** The window in a sidebar connection's name, or undefined if it isn't one. */
export function windowOfSidebarPort(portName: string): number | undefined {
  const match = /^sidebar\/(\d+)$/.exec(portName);
  return match ? Number(match[1]) : undefined;
}

/**
 * Everything a sidebar renders, for the window it's in. The core computes it, so the sidebar
 * only draws it.
 */
export interface SidebarView extends LibraryStructure {
  /** The Space this window shows. Each window has its own. */
  activeSpaceId: string;
  /** The Active Space's Today tabs in this window, in tab strip order. */
  todayTabs: TodayTab[];
}

/** An open tab in the Active Space's tab group that isn't a Pinned tab or a Favorite. */
export interface TodayTab {
  /** Chrome's tab ID. */
  id: number;
  title: string;
  url: string;
  /** Whether it's the window's active tab. */
  active: boolean;
}

/** What a sidebar asks the core to do. */
export type SidebarCommand =
  | { type: 'createSpace'; icon: string | null; label: string; color: SpaceColor }
  | { type: 'renameSpace'; spaceId: string; label: string }
  | { type: 'setSpaceIcon'; spaceId: string; icon: string | null }
  | { type: 'setSpaceColor'; spaceId: string; color: SpaceColor }
  | { type: 'moveSpace'; spaceId: string; toIndex: number }
  /** Makes a Space the Active Space of the sidebar's window. */
  | { type: 'switchSpace'; spaceId: string }
  /** Activates one of the window's tabs. */
  | { type: 'activateTab'; tabId: number };

/**
 * How a command went. A Space the command created is in `spaceId`. When it succeeds, the
 * sidebar has already been sent the view that shows the change.
 */
export type CommandOutcome =
  | { ok: true; spaceId?: string }
  | { ok: false; reason: LibraryErrorReason; spaceName?: string }
  /** Something unexpected went wrong, or the connection dropped before the core replied. */
  | { ok: false; reason: 'failed' };

/** Messages from a sidebar to the core. */
export type SidebarMessage = { type: 'command'; requestId: number; command: SidebarCommand };

/** Messages from the core to a sidebar. */
export type CoreMessage =
  | { type: 'view'; view: SidebarView }
  /** The view couldn't be computed. `message` is for the console, not the user. */
  | { type: 'error'; message: string }
  | { type: 'commandResult'; requestId: number; outcome: CommandOutcome };
