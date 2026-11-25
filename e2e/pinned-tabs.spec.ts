import type { Worker } from '@playwright/test';
import { type Chrome, coreStarted, expect, test } from './fixtures';

// Pages that load without a network, each with its own title.
const page = (title: string) => `data:text/html,<title>${title}</title>${title}`;
// Chrome won't let an extension navigate a tab to a data: URL, so the Pinned URL that the
// "back" button returns to is an about:blank page.
const DOCS = 'about:blank#docs';

/**
 * The window's tabs in Space groups as Chrome reports them, in strip order: URL, with `*` on
 * the active tab. The tab Chrome opens before the extension starts stays outside them.
 */
function tabsOf(serviceWorker: Worker, windowId: number) {
  return serviceWorker.evaluate(async (windowId) => {
    const { tabs } = (globalThis as unknown as { chrome: Chrome }).chrome;
    return (await tabs.query({ windowId }))
      .filter((tab) => tab.groupId !== -1)
      .map((tab) => `${tab.url}${tab.active ? '*' : ''}`);
  }, windowId);
}

/** The bookmarks in the Home Space's folder: its Pinned tabs, as title and URL. */
function homePinnedTabs(serviceWorker: Worker) {
  return serviceWorker.evaluate(async () => {
    const { bookmarks } = (globalThis as unknown as { chrome: Chrome }).chrome;
    const [tree] = await bookmarks.getTree();
    const otherBookmarks = tree!.children!.find((node) => node.folderType === 'other')!;
    const root = otherBookmarks.children!.find((node) => node.title === 'Remembering Arc')!;
    const home = root.children!.find((node) => node.title === 'Home')!;
    return home.children!.map((node) => ({ title: node.title, url: node.url }));
  });
}

test('Pinned tabs open without duplicates, go back to their Pinned URL, and can be pinned and unpinned', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // The sidebar page in a tab of its own shows that tab's window, and is a Today tab in Home.
  await coreStarted(serviceWorker);
  const sidebar = await context.newPage();
  const sidebarUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  await sidebar.goto(sidebarUrl);
  const pinned = sidebar.getByRole('list', { name: 'Pinned tabs' });
  const todayTabs = sidebar.getByRole('list', { name: 'Today tabs' });
  await expect(todayTabs.getByRole('button')).toHaveCount(1);

  // A Pinned tab added in the bookmark manager shows as not open.
  const windowId = await serviceWorker.evaluate(
    async ({ sidebarUrl, docs }) => {
      const { bookmarks, tabs } = (globalThis as unknown as { chrome: Chrome }).chrome;
      const [tree] = await bookmarks.getTree();
      const otherBookmarks = tree!.children!.find((node) => node.folderType === 'other')!;
      const root = otherBookmarks.children!.find((node) => node.title === 'Remembering Arc')!;
      const home = root.children!.find((node) => node.title === 'Home')!;
      await bookmarks.create({ parentId: home.id, title: 'Docs', url: docs });
      return (await tabs.query({ url: sidebarUrl }))[0]!.windowId;
    },
    { sidebarUrl, docs: DOCS },
  );
  const docs = pinned.getByRole('button', { name: 'Docs' });
  await expect(docs).toHaveAccessibleDescription('Not open');

  // Clicking it opens it in a new tab, which isn't a Today tab.
  await docs.click();
  await expect.poll(() => tabsOf(serviceWorker, windowId)).toEqual([sidebarUrl, `${DOCS}*`]);
  await expect(docs).not.toHaveAccessibleDescription('Not open');
  await expect(docs).toHaveAttribute('aria-current', 'page');
  await expect(todayTabs.getByRole('button')).toHaveCount(1);

  // Clicking it again, from another tab, goes back to the same tab instead of opening another.
  await todayTabs.getByRole('button').click();
  await expect.poll(() => tabsOf(serviceWorker, windowId)).toEqual([`${sidebarUrl}*`, DOCS]);
  await docs.click();
  await expect.poll(() => tabsOf(serviceWorker, windowId)).toEqual([sidebarUrl, `${DOCS}*`]);

  // Browsing away inside it marks it as wandered, with a way back to its Pinned URL.
  const docsPage = context.pages().find((each) => each.url() === DOCS)!;
  await docsPage.goto(page('Drafts'));
  await expect(docs).toHaveAccessibleDescription('Now on Drafts');
  await pinned.getByRole('button', { name: 'Back to Pinned URL' }).click();
  await expect.poll(() => tabsOf(serviceWorker, windowId)).toEqual([sidebarUrl, `${DOCS}*`]);
  await expect(docs).not.toHaveAccessibleDescription(/Now on/);
  await expect(pinned.getByRole('button', { name: 'Back to Pinned URL' })).toHaveCount(0);

  // Dragging a Today tab above a Pinned tab pins it there.
  await serviceWorker.evaluate(
    async ({ windowId, report }) => {
      const { tabs } = (globalThis as unknown as { chrome: Chrome }).chrome;
      await tabs.create({ windowId, url: report, active: false });
    },
    { windowId, report: page('Report') },
  );
  const report = todayTabs.getByRole('button', { name: 'Report' });
  const target = (await docs.boundingBox())!;
  await report.hover();
  await sidebar.mouse.down();
  await sidebar.mouse.move(target.x + target.width / 2, target.y + 4, { steps: 10 });
  await sidebar.mouse.up();
  await expect
    .poll(() => homePinnedTabs(serviceWorker))
    .toEqual([
      { title: 'Report', url: page('Report') },
      { title: 'Docs', url: DOCS },
    ]);
  await expect(pinned.getByRole('button')).toHaveText(['Report', 'Docs']);
  await expect(todayTabs.getByRole('button', { name: 'Report' })).toHaveCount(0);

  // Unpinning it from its menu makes its tab a Today tab again.
  await pinned.getByRole('button', { name: 'Report' }).click({ button: 'right' });
  await sidebar.getByRole('menuitem', { name: 'Unpin' }).click();
  await expect.poll(() => homePinnedTabs(serviceWorker)).toEqual([{ title: 'Docs', url: DOCS }]);
  await expect(todayTabs.getByRole('button', { name: 'Report' })).toBeVisible();

  // Pin from a Today tab's menu adds it after the other Pinned tabs.
  await todayTabs.getByRole('button', { name: 'Report' }).click({ button: 'right' });
  await sidebar.getByRole('menuitem', { name: 'Pin' }).click();
  await expect
    .poll(() => homePinnedTabs(serviceWorker))
    .toEqual([
      { title: 'Docs', url: DOCS },
      { title: 'Report', url: page('Report') },
    ]);
});
