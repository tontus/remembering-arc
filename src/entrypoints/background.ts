import { defineBackground } from 'wxt/utils/define-background';
import { createChromeBrowser } from '../browser/chrome-browser';
import { startCore } from '../core/core';

export default defineBackground(() => {
  startCore(createChromeBrowser());
});
