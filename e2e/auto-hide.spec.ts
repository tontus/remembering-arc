import { type Chrome, expect, test } from './fixtures';

test.use({ allSitesAccess: true });

const PAGE_URL = 'https://example.test/';

test('hovering at the edge of a web page reveals the sidebar, over the page', async ({
  context,
  page,
  extensionId,
  serviceWorker,
}) => {
  await context.route(`${PAGE_URL}**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>A web page</title><main>A normal web page</main>',
    }),
  );

  // Turn Auto-hide on from the sidebar's settings. Access is already granted, so Chrome
  // doesn't prompt.
  const sidebarTab = await context.newPage();
  await sidebarTab.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidebarTab.getByText('Settings').click();
  const autoHide = sidebarTab.getByRole('switch', { name: 'Auto-hide' });
  // The switch turns on once Chrome confirms access, so it doesn't flip during the click.
  await autoHide.click();
  await expect(autoHide).toBeChecked();
  await sidebarTab.close();
  // The core registers the overlay for pages that load from now on.
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () =>
        (await (globalThis as unknown as { chrome: Chrome }).chrome.scripting.getRegisteredContentScripts()).length,
      ),
    )
    .toBe(1);
  const side = await serviceWorker.evaluate(async () => {
    const { sidePanel } = (globalThis as unknown as { chrome: Chrome }).chrome;
    return sidePanel.getLayout ? (await sidePanel.getLayout()).side : 'right';
  });

  await page.goto(PAGE_URL);
  const frame = page.locator('remembering-arc-auto-hide iframe');
  const pageWidth = () => page.locator('main').evaluate((main) => main.getBoundingClientRect().width);
  const widthBefore = await pageWidth();
  // The overlay asks the core for the side before it listens for the mouse.
  await expect(page.locator(`remembering-arc-auto-hide[data-side="${side}"]`)).toBeAttached();

  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  await page.mouse.move(side === 'left' ? 1 : width - 2, height / 2);

  await expect(frame).toBeInViewport({ ratio: 1 });
  await expect(page.frameLocator('remembering-arc-auto-hide iframe').getByRole('heading', { name: 'Home' })).toBeVisible();
  expect(await pageWidth()).toBe(widthBefore);

  await page.mouse.move(width / 2, height / 2);
  await expect(frame).toBeHidden();
});
