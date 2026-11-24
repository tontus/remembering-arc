import type { BrowserPort } from './port';

/**
 * What the tab group spike observed in real Chromium (ADR-0002), written as scenarios that
 * run unchanged against the fake browser (Vitest) and against Chromium with a bare extension
 * (Playwright), so the fake can't drift from Chrome.
 *
 * Playwright sends each scenario's source to the service worker, so a scenario uses nothing
 * but its argument: no imports, constants or helpers from outside the function. Each one
 * resolves with what it saw; the tests expect `PARITY_EXPECTATIONS`.
 */
export type ParityBrowser = Pick<BrowserPort, 'tabs' | 'tabGroups'>;

/**
 * Collapsing the group that holds the active tab succeeds, and the tab stays active, even
 * when every other tab is grouped and collapsed. Chrome neither moves focus nor opens a tab.
 */
export async function collapseGroupOfActiveTab({ tabs, tabGroups }: ParityBrowser) {
  const active = await tabs.create({ active: true });
  const windowId = active.windowId;
  const groupId = await tabs.group({ tabIds: active.id!, createProperties: { windowId } });
  const others = (await tabs.query({ windowId })).flatMap((tab) => (tab.id === active.id || tab.pinned ? [] : [tab.id!]));
  if (others.length > 0) {
    const rest = await tabs.group({ tabIds: others as [number, ...number[]], createProperties: { windowId } });
    await tabGroups.update(rest, { collapsed: true });
  }
  const tabCount = (await tabs.query({ windowId })).length;

  await tabGroups.update(groupId, { collapsed: true });

  return {
    groupCollapsed: (await tabGroups.get(groupId)).collapsed,
    tabStillActive: (await tabs.query({ windowId, active: true }))[0]?.id === active.id,
    tabCountUnchanged: (await tabs.query({ windowId })).length === tabCount,
  };
}

/** Activating a tab inside a collapsed group expands that group. */
export async function activateTabInCollapsedGroup({ tabs, tabGroups }: ParityBrowser) {
  const hidden = await tabs.create({ active: false });
  const windowId = hidden.windowId;
  await tabs.create({ windowId, active: true });
  const groupId = await tabs.group({ tabIds: hidden.id!, createProperties: { windowId } });
  await tabGroups.update(groupId, { collapsed: true });

  await tabs.update(hidden.id!, { active: true });

  return {
    groupCollapsed: (await tabGroups.get(groupId)).collapsed,
    tabActive: (await tabs.get(hidden.id!)).active,
  };
}

/** A tab made with `tabs.create` lands outside every group, at the end of the strip. */
export async function createTabAfterGroups({ tabs }: ParityBrowser) {
  const grouped = await tabs.create({ active: false });
  const windowId = grouped.windowId;
  await tabs.group({ tabIds: grouped.id!, createProperties: { windowId } });

  const created = await tabs.create({ windowId, active: false });

  const strip = await tabs.query({ windowId });
  return {
    // Chrome's TAB_GROUP_ID_NONE.
    inNoGroup: created.groupId === -1,
    atEndOfStrip: created.index === strip.length - 1,
  };
}

export const PARITY_EXPECTATIONS = {
  collapseGroupOfActiveTab: { groupCollapsed: true, tabStillActive: true, tabCountUnchanged: true },
  activateTabInCollapsedGroup: { groupCollapsed: false, tabActive: true },
  createTabAfterGroups: { inNoGroup: true, atEndOfStrip: true },
};
