import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createChromeBrowser } from '../../browser/chrome-browser';
import { localizeDocument } from '../../i18n';
import { BrowserProvider } from '../../sidebar/browser-context';
import { Sidebar } from '../../sidebar/Sidebar';
import '../../sidebar/sidebar.css';

const browser = createChromeBrowser();
localizeDocument(browser.i18n, document);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserProvider browser={browser}>
      <Sidebar />
    </BrowserProvider>
  </StrictMode>,
);
