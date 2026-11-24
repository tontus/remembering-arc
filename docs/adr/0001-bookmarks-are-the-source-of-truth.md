# Chrome bookmarks are the source of truth and the sync channel

Spaces, Pinned tabs, Folders and Favorites are stored as bookmarks in one root folder, and the extension reads and writes that tree directly instead of keeping its own copy. Chrome's bookmark sync carries the structure to every device for free, phones included, with no backend to run and no two-way merge to write. Only this persistent structure syncs. Today tabs, each window's Active Space and the link between open tabs and Pinned tabs stay in local extension storage on each device.

Layout: bookmarks directly in the root folder are Favorites, subfolders of the root are Spaces, bookmarks inside a Space are Pinned tabs, and subfolders inside a Space are Folders. Bookmark order is display order. No folder names are reserved.

## Considered Options

- **`chrome.storage.sync` as the store**: 100 KB total and 8 KB per item, invisible to users, and gone if the extension is uninstalled.
- **Extension storage as the truth, bookmarks as a mirror**: needs a two-way merge and a conflict policy.
- **A sync backend of our own**: servers, accounts and privacy obligations for an open-source project.

## Consequences

- Bookmarks have no custom fields, and bookmark IDs differ on each device. Extra Space data lives in the tree itself (the Space icon is an emoji at the start of the folder title) or in synced extension storage keyed by Space name (the Space color, one of Chrome's nine tab group colors, which resets if the Space is renamed outside the extension).
- Each device finds the root folder by name on its first run, then by its device-local bookmark ID. Renaming the root, whether the user does it or we do at the product rename, doesn't break existing devices. The root's current name is kept in synced extension storage so a new device can find a renamed root.
- Two devices can each create a root before either has synced. A device that sees more than one root moves everything into the oldest and deletes the empty duplicate. Space names are unique, so Spaces with the same name merge. Only empty folders are ever deleted by a merge.
- Chrome has no bookmark trash, so deleting a Space from the sidebar keeps a local snapshot for a short Undo.
- The link between open tabs and Pinned tabs doesn't survive a restart. It's rebuilt by matching restored tabs against Pinned URLs, so a Pinned tab that had navigated away comes back as a Today tab.
- Users can change the structure in Chrome's bookmark manager or on another device at any time, so the extension must react to external bookmark changes.
- Chrome can hold separate local and account bookmark trees, so there may be two "Other bookmarks" folders. The root folder goes in the one with `folderType: "other"` and `syncing: true`. If none exists, the extension uses the local one and shows a "Not syncing" notice.
