import type { LibraryStructure } from '../library/structure';

/** The name of the connection each open sidebar makes to the core. */
export const SIDEBAR_PORT_NAME = 'sidebar';

/** Everything a sidebar renders. The core computes it, so the sidebar only draws it. */
export type SidebarView = LibraryStructure;

/** Messages from the core to a sidebar. */
export type CoreMessage =
  | { type: 'view'; view: SidebarView }
  /** The view couldn't be computed. `message` is for the console, not the user. */
  | { type: 'error'; message: string };
