import { type Chrome, expect, test } from './fixtures';

test('creating, changing and reordering Spaces from the sidebar writes them to bookmarks', async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  /** The Space folders in the root, and the colors stored for them. */
  const library = () =>
    serviceWorker.evaluate(async () => {
      const { bookmarks, storage } = (globalThis as unknown as { chrome: Chrome }).chrome;
      const [tree] = await bookmarks.getTree();
      const otherBookmarks = tree!.children!.find((node) => node.folderType === 'other')!;
      const root = otherBookmarks.children!.find((node) => node.title === 'Remembering Arc')!;
      return {
        spaces: root.children!.filter((node) => node.url === undefined).map((node) => node.title),
        colors: await storage.sync.get(null),
      };
    });

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const switcher = page.getByRole('navigation', { name: 'Spaces' });
  await expect(switcher.getByRole('button', { name: 'Home', pressed: true })).toBeVisible();

  // Create a Space.
  await switcher.getByRole('button', { name: 'New Space' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Launch');
  await page.getByRole('radio', { name: '🚀' }).check();
  await page.getByRole('radio', { name: 'Purple' }).check();
  await page.getByRole('button', { name: 'Create Space' }).click();

  await expect(page.getByRole('heading', { name: '🚀 Launch' })).toBeVisible();
  await expect(switcher.getByRole('button', { name: '🚀 Launch', pressed: true })).toBeFocused();
  await expect.poll(library).toEqual({ spaces: ['Home', '🚀 Launch'], colors: { 'spaceColor:🚀 Launch': 'purple' } });

  // Rename it. The color goes with it.
  await page.getByRole('button', { name: 'Edit Space' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Liftoff');
  await page.getByRole('textbox', { name: 'Name' }).press('Enter');
  await expect(page.getByRole('heading', { name: '🚀 Liftoff' })).toBeVisible();
  await expect.poll(library).toEqual({ spaces: ['Home', '🚀 Liftoff'], colors: { 'spaceColor:🚀 Liftoff': 'purple' } });

  // A name another Space has is turned down.
  await switcher.getByRole('button', { name: 'New Space' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Home');
  await page.getByRole('button', { name: 'Create Space' }).click();
  await expect(page.getByRole('alert')).toHaveText('Another Space is already called “Home”.');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect((await library()).spaces).toEqual(['Home', '🚀 Liftoff']);

  // Drag a Space's icon before another's.
  const liftoff = switcher.getByRole('button', { name: '🚀 Liftoff' });
  const home = switcher.getByRole('button', { name: 'Home' });
  const to = (await home.boundingBox())!;
  await liftoff.hover();
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await library()).spaces).toEqual(['🚀 Liftoff', 'Home']);
  await expect
    .poll(() => switcher.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.ariaLabel)))
    .toEqual(['🚀 Liftoff', 'Home', 'New Space']);

  // And with the keyboard.
  await home.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => (await library()).spaces).toEqual(['Home', '🚀 Liftoff']);
  await expect(home).toBeFocused();
});
