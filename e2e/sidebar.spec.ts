import { type Chrome, expect, test } from './fixtures';

test('the toolbar icon opens the sidebar in the side panel', async ({ serviceWorker }) => {
  await expect
    .poll(() =>
      serviceWorker.evaluate(() =>
        (globalThis as unknown as { chrome: Chrome }).chrome.sidePanel.getPanelBehavior(),
      ),
    )
    .toEqual({ openPanelOnActionClick: true });
});

test('the sidebar lists a Space and follows changes made outside it', async ({ page, extensionId, serviceWorker }) => {
  // The side panel shows this same page.
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const switcher = page.getByRole('navigation', { name: 'Spaces' });
  await expect(switcher.getByRole('button', { name: 'Home', pressed: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  // A fresh profile isn't signed in, so its bookmarks don't sync.
  await expect(page.getByText('Not syncing')).toBeVisible();

  // Add a Space with a Pinned tab, as the bookmark manager would.
  await serviceWorker.evaluate(async () => {
    const { bookmarks } = (globalThis as unknown as { chrome: Chrome }).chrome;
    const [tree] = await bookmarks.getTree();
    const otherBookmarks = tree!.children!.find((node) => node.folderType === 'other')!;
    const root = otherBookmarks.children!.find((node) => node.title === 'Remembering Arc')!;
    const space = await bookmarks.create({ parentId: root.id, title: '🚀 Launch' });
    await bookmarks.create({ parentId: space.id, title: 'Playwright', url: 'https://playwright.dev/' });
  });

  await switcher.getByRole('button', { name: '🚀 Launch' }).click();
  await expect(page.getByRole('heading', { name: '🚀 Launch' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Pinned tabs' }).getByText('Playwright')).toBeVisible();
});
