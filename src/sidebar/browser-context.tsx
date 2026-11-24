import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import type { BrowserPort } from '../browser/port';
import type { SidebarView } from '../core/sidebar-protocol';
import { getMessage, type MessageKey } from '../i18n';
import { connectToCore } from './connect-to-core';

const BrowserContext = createContext<BrowserPort | null>(null);

export function BrowserProvider({ browser, children }: { browser: BrowserPort; children: ReactNode }) {
  return <BrowserContext value={browser}>{children}</BrowserContext>;
}

export function useBrowser(): BrowserPort {
  const browser = useContext(BrowserContext);
  if (!browser) throw new Error('useBrowser() needs a <BrowserProvider> above it.');
  return browser;
}

/** Returns `t(key)`, which looks up a user-facing string in the user's locale. */
export function useMessages(): (key: MessageKey) => string {
  const { i18n } = useBrowser();
  return (key) => getMessage(i18n, key);
}

export type SidebarState = { status: 'loading' } | { status: 'ready'; view: SidebarView } | { status: 'error' };

/** The view the core sends this sidebar, kept up to date. */
export function useSidebarState(): SidebarState {
  const browser = useBrowser();
  const [state, setState] = useState<SidebarState>({ status: 'loading' });
  useEffect(
    () =>
      connectToCore(browser, (message) => {
        if (message.type === 'view') {
          setState({ status: 'ready', view: message.view });
        } else {
          console.error('The core could not compute the sidebar view:', message.message);
          setState({ status: 'error' });
        }
      }),
    [browser],
  );
  return state;
}
