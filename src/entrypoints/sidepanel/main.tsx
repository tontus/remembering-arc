import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createChromeBrowser } from '../../browser/chrome-browser';
import { getMessage, localizeDocument } from '../../i18n';
import { BrowserProvider } from '../../sidebar/browser-context';
import { connectSidePanel, findSidebarPlace } from '../../sidebar/mode-controls';
import { Sidebar } from '../../sidebar/Sidebar';
import '../../sidebar/sidebar.css';

const browser = createChromeBrowser();
localizeDocument(browser.i18n, document);

const root = createRoot(document.getElementById('root')!);

// The sidebar shows the window it's in, so it finds its window first.
findSidebarPlace(browser, new URL(location.href))
  .then(({ host, windowId }) => {
    if (windowId === undefined) throw new Error('Chrome reported no window for the sidebar.');
    // In the side panel the sidebar is Docked. It closes when the user switches to Auto-hide.
    if (host === 'side-panel') connectSidePanel(browser, windowId, () => window.close());
    return windowId;
  })
  .then(
    (windowId) =>
      root.render(
        <StrictMode>
          <BrowserProvider browser={browser}>
            <Sidebar windowId={windowId} />
          </BrowserProvider>
        </StrictMode>,
      ),
    (error: unknown) => {
      console.error('Could not tell where the sidebar is:', error);
      root.render(
        <p className="status" role="alert">
          {getMessage(browser.i18n, 'windowError')}
        </p>,
      );
    },
  );
