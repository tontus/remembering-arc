import type { RuntimePort } from '../browser/port';

/** The page's icon from Chrome's favicon cache. Loading it never contacts the site. */
export function faviconUrl(runtime: Pick<RuntimePort, 'getURL'>, pageUrl: string, size = 32): string {
  const url = new URL(runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.href;
}
