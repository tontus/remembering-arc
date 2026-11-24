# Remembering Arc

An open-source Chrome extension that brings Arc-style Spaces and a vertical sidebar to Chrome. Spaces sync across devices through Chrome's own bookmark sync. (Working name: the product will be renamed before release.)

It's early: the sidebar shows your Spaces, Favorites, Pinned tabs and Folders from bookmarks. You can create Spaces, rename them, give each an emoji icon and one of Chrome's tab group colors, and drag them into a new order. Each Space keeps its open tabs in a tab group named and colored like it, one per window. Clicking a Space's icon expands its group and collapses the others, so every tab stays loaded, and the sidebar lists the Space's open tabs. New tabs join the window's Active Space. The sidebar is Docked in Chrome's side panel until you turn on Auto-hide in its settings, which asks for access to all websites. Ctrl+Shift+S (⌘⇧S on a Mac) switches between Auto-hide and Docked.

## Development

Requires Node 22.12 or later.

```bash
npm install
npm run dev        # WXT dev mode, with live reload
npm run build      # builds into .output/chrome-mv3
```

To try a build in your own Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick `.output/chrome-mv3`. Click the toolbar icon to open the sidebar.

## Tests

```bash
npm test           # Vitest: the core against an in-memory fake browser
npm run test:e2e   # Playwright: builds, then loads the extension into Chromium
npm run typecheck
```

Playwright needs its Chromium once: `npx playwright install chromium`.

## How it's built

- [`GLOSSARY.md`](GLOSSARY.md) defines the vocabulary: Space, Pinned tab, Folder, Favorite and so on.
- [`docs/adr/`](docs/adr/) records the decisions that may look odd, starting with bookmarks as the source of truth.
- `src/browser/` is the browser port, the only code that touches Chrome's extension APIs, and its in-memory fake for tests.
- `src/library/` reads the Space structure from bookmarks and changes it. `src/core/` runs in the background service worker and serves each open sidebar. `src/sidebar/` is the React sidebar. `src/auto-hide/` is the Auto-hide overlay that the content script adds to web pages.

## License

[MIT](LICENSE)
