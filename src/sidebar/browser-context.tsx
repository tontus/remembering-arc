import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { BrowserPort } from '../browser/port';
import type { CommandOutcome, SidebarCommand, SidebarView } from '../core/sidebar-protocol';
import { getMessage, type MessageKey } from '../i18n';
import { connectToCore, type CoreConnection } from './connect-to-core';

const BrowserContext = createContext<BrowserPort | null>(null);

export function BrowserProvider({ browser, children }: { browser: BrowserPort; children: ReactNode }) {
  return <BrowserContext value={browser}>{children}</BrowserContext>;
}

export function useBrowser(): BrowserPort {
  const browser = useContext(BrowserContext);
  if (!browser) throw new Error('useBrowser() needs a <BrowserProvider> above it.');
  return browser;
}

/**
 * Returns `t(key, substitutions)`, which looks up a user-facing string in the user's locale.
 */
export function useMessages(): (key: MessageKey, substitutions?: string | string[]) => string {
  const { i18n } = useBrowser();
  return (key, substitutions) => getMessage(i18n, key, substitutions);
}

export type SidebarState = { status: 'loading' } | { status: 'ready'; view: SidebarView } | { status: 'error' };

/** Sends the core a command and resolves with how it went. */
export type RunCommand = (command: SidebarCommand) => Promise<CommandOutcome>;

/** The view the core sends this sidebar, kept up to date, and a way to send it commands. */
export function useCore(): { state: SidebarState; run: RunCommand } {
  const browser = useBrowser();
  const [state, setState] = useState<SidebarState>({ status: 'loading' });
  const connection = useRef<CoreConnection>(null);
  useEffect(() => {
    const opened = connectToCore(browser, (message) => {
      if (message.type === 'view') {
        setState({ status: 'ready', view: message.view });
      } else {
        console.error('The core could not compute the sidebar view:', message.message);
        setState({ status: 'error' });
      }
    });
    connection.current = opened;
    return () => {
      opened.close();
      if (connection.current === opened) connection.current = null;
    };
  }, [browser]);
  const run = useCallback<RunCommand>(
    (command) => connection.current?.run(command) ?? Promise.resolve({ ok: false, reason: 'failed' }),
    [],
  );
  return { state, run };
}
