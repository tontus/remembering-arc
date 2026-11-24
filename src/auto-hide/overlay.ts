import type { BrowserPort } from '../browser/port';
import { AUTO_HIDE_PORT_NAME, type AutoHideLayout, autoHideFrameUrl, watchSidebarMode } from '../core/sidebar-mode';
import { getMessage } from '../i18n';

/**
 * How long the mouse rests at the edge before the sidebar slides in, so that reaching for
 * the scrollbar or the back button doesn't trigger it.
 */
export const REVEAL_DELAY_MS = 150;

/** How long after the mouse leaves the sidebar before it slides away, so a brief slip doesn't hide it. */
export const HIDE_DELAY_MS = 250;

/** The overlay's element, added to each page. Everything inside is in its shadow root. */
export const OVERLAY_ELEMENT = 'remembering-arc-auto-hide';

// Pages can style the element itself, so its own declarations win.
const HOST_STYLE = [
  'all: initial',
  'display: block',
  'position: fixed',
  'top: 0',
  'left: 0',
  'width: 0',
  'height: 0',
  'z-index: 2147483647',
]
  .map((declaration) => `${declaration} !important;`)
  .join(' ');

const SHADOW_STYLE = `
  .hover-zone {
    position: fixed;
    top: 0;
    bottom: 0;
    width: 6px;
  }
  :host(:not([data-side])) .hover-zone { display: none; }
  :host([data-side='left']) .hover-zone { left: 0; }
  :host([data-side='right']) .hover-zone { right: 0; }

  .sidebar {
    position: fixed;
    top: 0;
    width: 300px;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    box-shadow: 0 0 24px rgb(0 0 0 / 25%);
    visibility: hidden;
    pointer-events: none;
    transition: transform 160ms ease, visibility 0s linear 160ms;
  }
  :host([data-side='left']) .sidebar { left: 0; transform: translateX(-100%); }
  :host([data-side='right']) .sidebar { right: 0; transform: translateX(100%); }
  :host([data-side]) .sidebar.shown {
    visibility: visible;
    pointer-events: auto;
    transform: none;
    transition: transform 160ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar, .sidebar.shown { transition: none; }
  }
  @media print {
    :host { display: none !important; }
  }
`;

type OverlayBrowser = Pick<BrowserPort, 'storage' | 'runtime' | 'i18n'>;

/**
 * Runs Auto-hide in a web page. While the sidebar mode is Auto-hide, a hover zone at the
 * window's edge, on the side Chrome shows its side panel, slides the sidebar page in over
 * the page. It sits in an isolated frame above the page, so the page doesn't reflow.
 * Returns a function that removes it for good.
 */
export function startAutoHide(browser: OverlayBrowser, document: Document): () => void {
  // Leave alone documents that aren't HTML, such as SVG files.
  if (!(document.documentElement instanceof HTMLHtmlElement)) return () => {};

  let overlay: Overlay | undefined;
  const stopWatching = watchSidebarMode(browser.storage.local, (mode) => {
    if (mode === 'auto-hide') {
      overlay ??= new Overlay(browser, document);
    } else {
      overlay?.remove();
      overlay = undefined;
    }
  });
  return () => {
    stopWatching();
    overlay?.remove();
    overlay = undefined;
  };
}

class Overlay {
  readonly #browser: OverlayBrowser;
  readonly #document: Document;
  readonly #host: HTMLElement;
  readonly #shadow: ShadowRoot;
  readonly #listening = new AbortController();
  #frame: HTMLIFrameElement | undefined;
  #shown = false;
  #revealTimer: ReturnType<typeof setTimeout> | undefined;
  #hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(browser: OverlayBrowser, document: Document) {
    this.#browser = browser;
    this.#document = document;
    this.#host = document.createElement(OVERLAY_ELEMENT);
    this.#host.setAttribute('style', HOST_STYLE);
    this.#shadow = this.#host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = SHADOW_STYLE;
    const hoverZone = document.createElement('div');
    hoverZone.className = 'hover-zone';
    this.#listenForPointer(hoverZone);
    this.#shadow.append(style, hoverZone);
    document.documentElement.append(this.#host);

    this.#askForSide();
    // The user may have moved Chrome's side panel while the page was in the background.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') this.#askForSide();
      },
      { signal: this.#listening.signal },
    );
  }

  remove(): void {
    this.#listening.abort();
    clearTimeout(this.#revealTimer);
    clearTimeout(this.#hideTimer);
    this.#host.remove();
  }

  #askForSide(): void {
    const port = this.#browser.runtime.connect({ name: AUTO_HIDE_PORT_NAME });
    port.onMessage.addListener((message) => {
      port.disconnect();
      if (this.#listening.signal.aborted) return;
      this.#host.dataset.side = (message as AutoHideLayout).side;
    });
  }

  #listenForPointer(element: HTMLElement): void {
    const { signal } = this.#listening;
    element.addEventListener('mouseenter', () => this.#pointerEntered(), { signal });
    element.addEventListener('mouseleave', () => this.#pointerLeft(), { signal });
  }

  #pointerEntered(): void {
    clearTimeout(this.#hideTimer);
    if (this.#shown) return;
    // Start loading the sidebar now, so it's ready by the time it slides in.
    this.#loadFrame();
    clearTimeout(this.#revealTimer);
    this.#revealTimer = setTimeout(() => this.#show(true), REVEAL_DELAY_MS);
  }

  #pointerLeft(): void {
    clearTimeout(this.#revealTimer);
    if (!this.#shown) return;
    clearTimeout(this.#hideTimer);
    this.#hideTimer = setTimeout(() => this.#show(false), HIDE_DELAY_MS);
  }

  #loadFrame(): void {
    if (this.#frame) return;
    const frame = this.#document.createElement('iframe');
    frame.className = 'sidebar';
    frame.title = getMessage(this.#browser.i18n, 'autoHideFrameTitle');
    frame.src = autoHideFrameUrl(this.#browser.runtime);
    this.#listenForPointer(frame);
    this.#shadow.append(frame);
    this.#frame = frame;
  }

  #show(shown: boolean): void {
    this.#shown = shown;
    this.#frame?.classList.toggle('shown', shown);
    // Typing shouldn't go on into a sidebar that has slid away.
    if (!shown && this.#shadow.activeElement === this.#frame) this.#frame?.blur();
  }
}
