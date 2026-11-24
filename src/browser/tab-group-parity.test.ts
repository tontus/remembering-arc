import { describe, expect, it } from 'vitest';
import { createFakeBrowser } from './fake/fake-browser';
import {
  activateTabInCollapsedGroup,
  collapseGroupOfActiveTab,
  createTabAfterGroups,
  PARITY_EXPECTATIONS,
} from './tab-group-parity';

// The same scenarios run against real Chromium in e2e/tab-group-parity.spec.ts.
describe('the fake tab groups behave as the spike saw Chrome behave (ADR-0002)', () => {
  it('leaves the active tab active when its group collapses', async () => {
    const browser = createFakeBrowser();
    browser.tabs.open({ url: 'https://example.com/' });

    expect(await collapseGroupOfActiveTab(browser)).toEqual(PARITY_EXPECTATIONS.collapseGroupOfActiveTab);
  });

  it('expands a collapsed group when one of its tabs is activated', async () => {
    expect(await activateTabInCollapsedGroup(createFakeBrowser())).toEqual(PARITY_EXPECTATIONS.activateTabInCollapsedGroup);
  });

  it('opens a created tab outside every group, at the end of the strip', async () => {
    expect(await createTabAfterGroups(createFakeBrowser())).toEqual(PARITY_EXPECTATIONS.createTabAfterGroups);
  });
});
