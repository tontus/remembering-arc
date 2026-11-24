import {
  activateTabInCollapsedGroup,
  collapseGroupOfActiveTab,
  createTabAfterGroups,
  PARITY_EXPECTATIONS,
  type ParityBrowser,
} from '../src/browser/tab-group-parity';
import { expect, test } from './fixtures';

// The tab group spike's findings (ADR-0002), checked against real Chromium. The fake browser
// runs the same scenarios in src/browser/tab-group-parity.test.ts, so it can't drift.
test.use({ bareExtension: true });

/** Runs a scenario in the bare extension's service worker, against Chrome's own APIs. */
function inChrome<T>(scenario: (browser: ParityBrowser) => Promise<T>): string {
  return `(${scenario.toString()})(chrome)`;
}

test('collapsing the group that holds the active tab leaves the tab active', async ({ serviceWorker }) => {
  expect(await serviceWorker.evaluate(inChrome(collapseGroupOfActiveTab))).toEqual(PARITY_EXPECTATIONS.collapseGroupOfActiveTab);
});

test('activating a tab in a collapsed group expands the group', async ({ serviceWorker }) => {
  expect(await serviceWorker.evaluate(inChrome(activateTabInCollapsedGroup))).toEqual(
    PARITY_EXPECTATIONS.activateTabInCollapsedGroup,
  );
});

test('a created tab opens outside every group, at the end of the strip', async ({ serviceWorker }) => {
  expect(await serviceWorker.evaluate(inChrome(createTabAfterGroups))).toEqual(PARITY_EXPECTATIONS.createTabAfterGroups);
});
