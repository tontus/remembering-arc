---
status: proposed
---

# Each Space is one tab group per window

Chrome can't hide tabs, so every open tab sits in its native tab strip. A window shows its Active Space by expanding that Space's tab group and collapsing the groups of every other Space. Tabs stay loaded, and the native strip (horizontal or vertical) always agrees with the sidebar. Open Favorites are Chrome-pinned tabs, so they stay visible in every Space, and any tab that ends up outside a group joins the window's Active Space as a Today tab.

This stays proposed until a spike confirms three things: what Chrome does when the group holding the active tab is collapsed, whether activating a tab in a collapsed group expands it, and how Chrome's automatic saved-group sync looks on a second device.

## Spike findings (2026-11-24)

The first two questions were tested with a throwaway extension driven by Playwright, in its bundled Chromium 159.0.8154.6 in a visible window on macOS. Branded Chrome no longer loads unpacked extensions from the command line, so stable Chrome (158) couldn't be scripted. Chromium shares Chrome's tab strip code. Only API results were checked: how the strip draws a collapsed group that holds the active tab wasn't checked by eye.

- **Collapsing the group that holds the active tab** succeeds with no error. The group reports `collapsed: true` and the active tab stays where it is. That holds even when every other tab is grouped and collapsed, and when a Chrome-pinned tab exists. Chrome never moves focus or opens a tab by itself.
- **Activating a tab inside a collapsed group** expands that group automatically.
- **A tab made with `chrome.tabs.create`** lands outside every group at the end of the strip, so stray tabs have to be adopted into the Active Space.
- **After `tabGroups.update` sets a title**, `tabGroups.query` returns the new title. ChromeSideBar works around a stale-title bug reported against Brave (brave/brave-browser#52949), but it didn't reproduce here.

**Switching order:** first activate a tab in the target Space, which expands its group, then collapse every other Space's group. Expanding the target explicitly is harmless but unnecessary. Activating last ends in the same state, but along the way the active tab sits inside a collapsed group, so avoid that order. Because Chrome won't move focus by itself, the extension must activate the target tab before collapsing anything. For a Space with no open tabs, that means creating its new tab and grouping it first.

**Verdict:** both behaviors support the tab-group model. The status stays proposed until the second-device check (#4) reports.

**ChromeSideBar** (Apache-2.0) also links Spaces to tab groups by title, but it never collapses groups: switching Spaces only filters its sidebar. It keeps Spaces in local extension storage rather than in synced bookmarks. It keeps the link between tabs and saved items per window in session storage, plus a local backup that is matched after a restart, first by tab ID, then by tab index and domain, then by domain alone.

## Considered Options

- **One window per Space**: no tab groups and no saved-group side effects, but switching Spaces swaps whole windows. This is the fallback if the spike fails.
- **Swapping tabs on switch**: a clean strip, but scroll position, form input and playing media are lost on every switch.

## Consequences

- Recent Chrome saves every tab group automatically. With tab group sync on, a Space's open tabs can appear as saved groups on other devices, which overlaps ADR-0001's rule that Today tabs stay local.
- Tab groups belong to one window, so a Space active in two windows has two groups, each with its own Today tabs.
- Chrome gives groups new IDs after a restart, so a group belongs to a Space when its title matches the Space's name, emoji included. Renaming a group in Chrome's strip renames the Space everywhere. A Space's color is one of Chrome's nine tab group colors, so the strip and the sidebar always match.
