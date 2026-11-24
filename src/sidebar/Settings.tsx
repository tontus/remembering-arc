import { type ChangeEvent, useEffect, useId, useState } from 'react';
import { type SidebarMode, watchSidebarMode } from '../core/sidebar-mode';
import { useBrowser, useMessages } from './browser-context';
import { findSidebarPlace, type SidebarPlace, switchToDocked, turnOnAutoHide } from './mode-controls';

export function Settings() {
  const t = useMessages();
  const browser = useBrowser();
  const mode = useSidebarMode();
  const place = useSidebarPlace();
  const [declined, setDeclined] = useState(false);
  const hintId = useId();

  const onAutoHideChange = (event: ChangeEvent<HTMLInputElement>) => {
    // Both calls need the click's user gesture, so they run straight away.
    if (event.currentTarget.checked) {
      turnOnAutoHide(browser).then(
        (on) => setDeclined(!on),
        (error: unknown) => console.error('Could not turn on Auto-hide:', error),
      );
    } else {
      setDeclined(false);
      switchToDocked(browser, place?.windowId).catch((error: unknown) => console.error('Could not switch to Docked:', error));
    }
  };

  return (
    <details className="settings">
      <summary>{t('settingsLabel')}</summary>
      <label className="setting">
        <input
          type="checkbox"
          role="switch"
          checked={mode === 'auto-hide'}
          disabled={mode === undefined}
          aria-describedby={hintId}
          onChange={onAutoHideChange}
        />
        {t('autoHideLabel')}
      </label>
      <p id={hintId} className="setting-hint">
        {t('autoHideHint')}
      </p>
      {declined && (
        <p className="setting-hint" role="status">
          {t('autoHideDeclined')}
        </p>
      )}
    </details>
  );
}

/** The sidebar mode, kept up to date. Undefined until it's read. */
function useSidebarMode(): SidebarMode | undefined {
  const { storage } = useBrowser();
  const [mode, setMode] = useState<SidebarMode>();
  useEffect(() => watchSidebarMode(storage.local, setMode), [storage]);
  return mode;
}

/** Where this sidebar page is shown. Undefined until it's known. */
function useSidebarPlace(): SidebarPlace | undefined {
  const browser = useBrowser();
  const [place, setPlace] = useState<SidebarPlace>();
  useEffect(() => {
    let current = true;
    findSidebarPlace(browser, new URL(location.href)).then(
      (found) => current && setPlace(found),
      (error: unknown) => console.error('Could not tell where the sidebar is:', error),
    );
    return () => {
      current = false;
    };
  }, [browser]);
  return place;
}
