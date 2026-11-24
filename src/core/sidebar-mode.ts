import type { Permissions, RuntimePort, SidePanelSide, StorageAreaPort } from '../browser/port';

/**
 * How the sidebar is shown (ADR-0003). Auto-hide slides it over the page from the window's
 * edge; Docked keeps it open in Chrome's side panel. Shared by the core, the sidebar page
 * and the Auto-hide content script.
 */
export type SidebarMode = 'auto-hide' | 'docked';

/** The local extension storage key of the sidebar mode. Each device keeps its own. */
export const SIDEBAR_MODE_KEY = 'sidebarMode';

/**
 * Auto-hide adds its overlay to every website, so it needs this optional permission. The
 * extension asks for it only when the user turns Auto-hide on.
 */
export const ALL_SITES = { origins: ['<all_urls>'] } satisfies Permissions;

/** The keyboard shortcut that switches between Auto-hide and Docked, declared in `wxt.config.ts`. */
export const TOGGLE_SIDEBAR_MODE_COMMAND = 'toggle-sidebar-mode';

/** The Auto-hide content script, which WXT builds from `entrypoints/auto-hide.content.ts`. */
export const AUTO_HIDE_SCRIPT = { id: 'auto-hide', file: 'content-scripts/auto-hide.js' };

/** The sidebar page, as the Auto-hide overlay loads it in its frame. */
export function autoHideFrameUrl(runtime: Pick<RuntimePort, 'getURL'>): string {
  return `${runtime.getURL('/sidepanel.html')}?host=auto-hide`;
}

/** Whether a sidebar page at `url` is inside the Auto-hide overlay's frame. */
export function isAutoHideFrame(url: URL): boolean {
  return url.searchParams.get('host') === 'auto-hide';
}

/** The connection the Auto-hide content script makes to ask the core which side to use. */
export const AUTO_HIDE_PORT_NAME = 'auto-hide';

/** The core's answer on an Auto-hide connection. */
export interface AutoHideLayout {
  side: SidePanelSide;
}

/**
 * The name of the connection the sidebar page keeps open while it's in the side panel of a
 * window, so the core knows where the side panel is open.
 */
export function sidePanelPortName(windowId: number): string {
  return `side-panel/${windowId}`;
}

/** The window in a side panel connection's name, or undefined if it isn't one. */
export function windowOfSidePanelPort(portName: string): number | undefined {
  const match = /^side-panel\/(\d+)$/.exec(portName);
  return match ? Number(match[1]) : undefined;
}

/** The sidebar mode. Docked until the user turns Auto-hide on. */
export async function readSidebarMode(local: StorageAreaPort): Promise<SidebarMode> {
  const { [SIDEBAR_MODE_KEY]: mode } = await local.get(SIDEBAR_MODE_KEY);
  return mode === 'auto-hide' ? 'auto-hide' : 'docked';
}

export async function writeSidebarMode(local: StorageAreaPort, mode: SidebarMode): Promise<void> {
  await local.set({ [SIDEBAR_MODE_KEY]: mode });
}

/** Calls `onChange` whenever the sidebar mode changes, until the returned function is called. */
export function onSidebarModeChanged(local: StorageAreaPort, onChange: (mode: SidebarMode) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>) => {
    if (SIDEBAR_MODE_KEY in changes) onChange(changes[SIDEBAR_MODE_KEY]!.newValue === 'auto-hide' ? 'auto-hide' : 'docked');
  };
  local.onChanged.addListener(listener);
  return () => local.onChanged.removeListener(listener);
}

/**
 * Calls `onChange` with the current sidebar mode and again whenever it changes, until the
 * returned function is called.
 */
export function watchSidebarMode(local: StorageAreaPort, onChange: (mode: SidebarMode) => void): () => void {
  let stopped = false;
  let changed = false;
  const stopListening = onSidebarModeChanged(local, (mode) => {
    changed = true;
    onChange(mode);
  });
  readSidebarMode(local)
    .then((mode) => {
      // A change that arrived first is newer than this read.
      if (!stopped && !changed) onChange(mode);
    })
    .catch((error: unknown) => console.error('Could not read the sidebar mode:', error));
  return () => {
    stopped = true;
    stopListening();
  };
}
