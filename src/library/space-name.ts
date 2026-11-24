import { leadingEmoji } from './leading-emoji';

/**
 * A Space's name: its folder title, icon included (ADR-0001). The icon is an emoji at the
 * start, followed by a space and the label, the part the user types.
 */
export function spaceName(icon: string | null, label: string): string {
  return icon === null ? label : `${icon} ${label}`;
}

/** The part of a Space's name after its icon. */
export function spaceLabel(name: string): string {
  const icon = leadingEmoji(name);
  return icon === null ? name : name.slice(icon.length).trimStart();
}

/** Whether `icon` is exactly one emoji, as a Space icon must be. */
export function isSpaceIcon(icon: string): boolean {
  return leadingEmoji(icon) === icon;
}
