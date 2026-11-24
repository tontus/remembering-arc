import type { Worker } from '@playwright/test';
import { type Chrome, coreStarted, expect, test } from './fixtures';

/**
 * The window's Space groups as Chrome reports them, in strip order: title, color, whether
 * collapsed, and their tabs' URLs, with `*` on the active tab.
 */
function spaceGroups(serviceWorker: Worker, windowId: number) {
  return serviceWorker.evaluate(async (windowId) => {
    const { tabs, tabGroups } = (globalThis as unknown as { chrome: Chrome }).chrome;
    const groups = await tabGroups.query({ windowId });
    const windowTabs = await tabs.query({ windowId });
    return groups
      .map((group) => ({
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        tabs: windowTabs.filter((tab) => tab.groupId === group.id).map((tab) => `${tab.url}${tab.active ? '*' : ''}`),
        index: windowTabs.find((tab) => tab.groupId === group.id)!.index,
      }))
      .sort((a, b) => a.index - b.index)
      .map(({ index: _index, ...group }) => group);
  }, windowId);
}

test('switching Spaces expands the target Space’s group and collapses the others', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // The sidebar page in a tab of its own shows that tab's window. Opened once the core is
  // running, the tab joins the window's Active Space, Home.
  await coreStarted(serviceWorker);
  const sidebar = await context.newPage();
  const sidebarUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  await sidebar.goto(sidebarUrl);
  const switcher = sidebar.getByRole('navigation', { name: 'Spaces' });
  await expect(switcher.getByRole('button', { name: 'Home', pressed: true })).toBeVisible();

  // Add a Space, and two tabs that join Home as Today tabs. The first is Home's last active tab.
  const windowId = await serviceWorker.evaluate(async (sidebarUrl) => {
    const { bookmarks, storage, tabs } = (globalThis as unknown as { chrome: Chrome }).chrome;
    const [tree] = await bookmarks.getTree();
    const otherBookmarks = tree!.children!.find((node) => node.folderType === 'other')!;
    const root = otherBookmarks.children!.find((node) => node.title === 'Remembering Arc')!;
    await storage.sync.set({ 'spaceColor:💼 Work': 'blue' });
    await bookmarks.create({ parentId: root.id, title: '💼 Work' });
    const [sidebarTab] = await tabs.query({ url: sidebarUrl });
    const mail = await tabs.create({ windowId: sidebarTab!.windowId, url: 'about:blank#mail', active: false });
    await tabs.create({ windowId: sidebarTab!.windowId, url: 'about:blank#docs', active: false });
    await tabs.update(mail.id!, { active: true });
    return sidebarTab!.windowId;
  }, sidebarUrl);
  await expect
    .poll(() => spaceGroups(serviceWorker, windowId))
    .toEqual([{ title: 'Home', color: 'grey', collapsed: false, tabs: [sidebarUrl, 'about:blank#mail*', 'about:blank#docs'] }]);
  const todayTabs = sidebar.getByRole('list', { name: 'Today tabs' });
  await expect(todayTabs.getByRole('button')).toHaveText([/.*/, 'about:blank#mail', 'about:blank#docs']);

  // Work has no tabs here, so it gets a new tab in a group named and colored like it.
  await switcher.getByRole('button', { name: '💼 Work' }).click();

  await expect
    .poll(() => spaceGroups(serviceWorker, windowId))
    .toEqual([
      { title: 'Home', color: 'grey', collapsed: true, tabs: [sidebarUrl, 'about:blank#mail', 'about:blank#docs'] },
      { title: '💼 Work', color: 'blue', collapsed: false, tabs: ['chrome://newtab/*'] },
    ]);
  await expect(switcher.getByRole('button', { name: '💼 Work', pressed: true })).toBeVisible();
  await expect(todayTabs.getByRole('button')).toHaveCount(1);

  // Back in Home, its last active tab is active again.
  await switcher.getByRole('button', { name: 'Home' }).click();

  await expect
    .poll(() => spaceGroups(serviceWorker, windowId))
    .toEqual([
      { title: 'Home', color: 'grey', collapsed: false, tabs: [sidebarUrl, 'about:blank#mail*', 'about:blank#docs'] },
      { title: '💼 Work', color: 'blue', collapsed: true, tabs: ['chrome://newtab/'] },
    ]);

  // Clicking a Today tab in the sidebar activates it.
  await todayTabs.getByRole('button', { name: 'about:blank#docs' }).click();
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async (windowId) =>
          (await (globalThis as unknown as { chrome: Chrome }).chrome.tabs.query({ windowId, active: true }))[0]?.url,
        windowId,
      ),
    )
    .toBe('about:blank#docs');
});
