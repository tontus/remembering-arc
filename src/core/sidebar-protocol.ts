import type { SpaceColor } from '../library/space-color';
import type { LibraryErrorReason } from '../library/space-commands';
import type { LibraryStructure } from '../library/structure';

/** The name of the connection each open sidebar makes to the core. */
export const SIDEBAR_PORT_NAME = 'sidebar';

/** Everything a sidebar renders. The core computes it, so the sidebar only draws it. */
export type SidebarView = LibraryStructure;

/** What a sidebar asks the core to do. */
export type SidebarCommand =
  | { type: 'createSpace'; icon: string | null; label: string; color: SpaceColor }
  | { type: 'renameSpace'; spaceId: string; label: string }
  | { type: 'setSpaceIcon'; spaceId: string; icon: string | null }
  | { type: 'setSpaceColor'; spaceId: string; color: SpaceColor }
  | { type: 'moveSpace'; spaceId: string; toIndex: number };

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
