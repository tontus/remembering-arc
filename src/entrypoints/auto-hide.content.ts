import { defineContentScript } from 'wxt/utils/define-content-script';
import { startAutoHide } from '../auto-hide/overlay';
import { createChromeBrowser } from '../browser/chrome-browser';

/**
 * The Auto-hide overlay. It isn't in the manifest: the core registers it only while the user
 * grants access to all websites (ADR-0003), so it has no `matches` here.
 */
export default defineContentScript({
  registration: 'runtime',
  main(ctx) {
    // A newer copy of this script, or an update of the extension, stops this one.
    ctx.onInvalidated(startAutoHide(createChromeBrowser(), document));
  },
});
