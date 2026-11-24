import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createChromeBrowser } from '../../browser/chrome-browser';
import { localizeDocument } from '../../i18n';
import { BrowserProvider } from '../../sidebar/browser-context';
import { connectSidePanel, findSidebarPlace } from '../../sidebar/mode-controls';
import { Sidebar } from '../../sidebar/Sidebar';
import '../../sidebar/sidebar.css';

const browser = createChromeBrowser();
localizeDocument(browser.i18n, document);

findSidebarPlace(browser, new URL(location.href)).then(
  ({ host, windowId }) => {
    // In the side panel the sidebar is Docked. It closes when the user switches to Auto-hide.
    if (host === 'side-panel' && windowId !== undefined) connectSidePanel(browser, windowId, () => window.close());
  },
  (error: unknown) => console.error('Could not tell where the sidebar is:', error),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserProvider browser={browser}>
      <Sidebar />
    </BrowserProvider>
  </StrictMode>,
);
