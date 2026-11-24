---
status: proposed
---

# Each Space is one tab group per window

Chrome can't hide tabs, so every open tab sits in its native tab strip. A window shows its Active Space by expanding that Space's tab group and collapsing the groups of every other Space. Tabs stay loaded, and the native strip (horizontal or vertical) always agrees with the sidebar. Open Favorites are Chrome-pinned tabs, so they stay visible in every Space, and any tab that ends up outside a group joins the window's Active Space as a Today tab.

This stays proposed until a spike confirms three things: what Chrome does when the group holding the active tab is collapsed, whether activating a tab in a collapsed group expands it, and how Chrome's automatic saved-group sync looks on a second device.

## Considered Options

- **One window per Space**: no tab groups and no saved-group side effects, but switching Spaces swaps whole windows. This is the fallback if the spike fails.
- **Swapping tabs on switch**: a clean strip, but scroll position, form input and playing media are lost on every switch.

## Consequences

- Recent Chrome saves every tab group automatically. With tab group sync on, a Space's open tabs can appear as saved groups on other devices, which overlaps ADR-0001's rule that Today tabs stay local.
- Tab groups belong to one window, so a Space active in two windows has two groups, each with its own Today tabs.
- Chrome gives groups new IDs after a restart, so a group belongs to a Space when its title matches the Space's name, emoji included. Renaming a group in Chrome's strip renames the Space everywhere. A Space's color is one of Chrome's nine tab group colors, so the strip and the sidebar always match.
