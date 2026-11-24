import type { TabGroupColor } from '../browser/port';

/** Chrome's nine tab group colors, in the order Chrome's own color picker shows them. */
export const SPACE_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const satisfies readonly TabGroupColor[];

/** A Space's color: one of Chrome's tab group colors, so the sidebar and the tab strip match. */
export type SpaceColor = (typeof SPACE_COLORS)[number];

/** The color of a Space that has none stored, such as one renamed outside the extension. */
export const DEFAULT_SPACE_COLOR: SpaceColor = 'grey';

const KEY_PREFIX = 'spaceColor:';

/**
 * The synced extension storage key that holds a Space's color. Bookmarks have no custom
 * fields, so the color is stored by the Space's name (ADR-0001).
 */
export function spaceColorKey(spaceName: string): string {
  return KEY_PREFIX + spaceName;
}

export function isSpaceColorKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX);
}

export function isSpaceColor(value: unknown): value is SpaceColor {
  return (SPACE_COLORS as readonly unknown[]).includes(value);
}
