/**
 * The browser port: the only seam between this extension and Chrome's extension APIs.
 *
 * Nothing outside `src/browser/` touches `chrome.*`. Code that needs Chrome takes a
 * `BrowserPort` and uses only what is declared here. `createChromeBrowser()` passes every
 * call straight through to Chrome; `createFakeBrowser()` (in `./fake`) is an in-memory
 * implementation for tests.
 *
 * The shapes mirror Chrome's own APIs, narrowed to what the extension uses. Add to them
 * when a feature needs more, and give the fake the same behavior.
 */

/** A Chrome event: `chrome.bookmarks.onCreated`, `port.onMessage` and so on. */
export interface BrowserEvent<Listener extends (...args: never[]) => void> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
  hasListener(listener: Listener): boolean;
}

// --- Bookmarks ---------------------------------------------------------------------------

/**
 * The kind of folder Chrome itself adds (Chrome 134+). Chrome can hold a local and an
 * account copy of each, told apart by `syncing`.
 */
export type BookmarkFolderType = 'bookmarks-bar' | 'other' | 'mobile' | 'managed';

export interface BookmarkNode {
  id: string;
  /** Omitted for the root node. */
  parentId?: string;
  /** Position within the parent. Bookmark order is display order. */
  index?: number;
  title: string;
  /** Omitted for folders. */
  url?: string;
  dateAdded?: number;
  dateGroupModified?: number;
  /** Set only on the folders Chrome adds, such as "Other bookmarks". */
  folderType?: BookmarkFolderType;
  /** Whether Chrome syncs this node to the user's account. */
  syncing: boolean;
  unmodifiable?: 'managed';
  /** Present on folders returned by `getTree()`. */
  children?: BookmarkNode[];
}

export interface BookmarkCreateDetails {
  parentId?: string;
  index?: number;
  title?: string;
  /** Omit to create a folder. */
  url?: string;
}

export interface BookmarkChanges {
  title?: string;
  url?: string;
}

export interface BookmarkDestination {
  parentId?: string;
  index?: number;
}

export interface BookmarkRemoveInfo {
  parentId: string;
  index: number;
  /** The removed node, with its whole subtree. */
  node: BookmarkNode;
}

export interface BookmarkChangeInfo {
  title: string;
  url?: string;
}

export interface BookmarkMoveInfo {
  parentId: string;
  index: number;
  oldParentId: string;
  oldIndex: number;
}

export interface BookmarkReorderInfo {
  childIds: string[];
}

export interface BookmarksPort {
  getTree(): Promise<BookmarkNode[]>;
  create(details: BookmarkCreateDetails): Promise<BookmarkNode>;
  update(id: string, changes: BookmarkChanges): Promise<BookmarkNode>;
  move(id: string, destination: BookmarkDestination): Promise<BookmarkNode>;
  /** Removes a bookmark or an empty folder. */
  remove(id: string): Promise<void>;
  /** Removes a folder and everything in it. */
  removeTree(id: string): Promise<void>;
  onCreated: BrowserEvent<(id: string, node: BookmarkNode) => void>;
  onRemoved: BrowserEvent<(id: string, info: BookmarkRemoveInfo) => void>;
  onChanged: BrowserEvent<(id: string, info: BookmarkChangeInfo) => void>;
  onMoved: BrowserEvent<(id: string, info: BookmarkMoveInfo) => void>;
  /** Fired when the bookmark manager sorts a folder. */
  onChildrenReordered: BrowserEvent<(id: string, info: BookmarkReorderInfo) => void>;
}

// --- Extension storage -------------------------------------------------------------------

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface StorageAreaPort {
  /** Omit `keys` or pass `null` to get everything. */
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  onChanged: BrowserEvent<(changes: Record<string, StorageChange>) => void>;
}

export interface StoragePort {
  /** Synced across the user's devices by Chrome. */
  sync: StorageAreaPort;
  /** Kept on this device. */
  local: StorageAreaPort;
  /** Kept on this device until the browser restarts. */
  session: StorageAreaPort;
}

// --- Runtime: messaging between the service worker and the sidebar --------------------

/** One end of a long-lived connection made with `runtime.connect()`. */
export interface MessagePort {
  readonly name: string;
  /** Throws if the port is disconnected. Messages are JSON-serialized. */
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: BrowserEvent<(message: unknown) => void>;
  /** Fired when the other end disconnects, or its context (such as the service worker) stops. */
  onDisconnect: BrowserEvent<() => void>;
}

export interface RuntimePort {
  /** Resolves a path inside the extension to a `chrome-extension://` URL. */
  getURL(path: string): string;
  connect(connectInfo: { name: string }): MessagePort;
  onConnect: BrowserEvent<(port: MessagePort) => void>;
}

// --- i18n and side panel -----------------------------------------------------------------

export interface I18nPort {
  /** Returns "" for an unknown message name. */
  getMessage(messageName: string, substitutions?: string | string[]): string;
}

/** The side of the window that Chrome shows its side panel on. The user picks it in Chrome's settings. */
export type SidePanelSide = 'left' | 'right';

export interface SidePanelPort {
  setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
  /** Opens the side panel in a window. Chrome allows it only straight after a user action, before any `await`. */
  open(options: { windowId: number }): Promise<void>;
  /** Chrome 140+. Missing on older versions. */
  getLayout?(): Promise<{ side: SidePanelSide }>;
}

// --- Tabs, windows and keyboard shortcuts --------------------------------------------------

export interface Tab {
  /** Missing for tabs that aren't in a browser window, such as devtools. */
  id?: number;
  windowId: number;
  active: boolean;
  /** Present only when the extension has host access to the page. */
  url?: string;
}

export interface TabsPort {
  query(queryInfo: { windowId?: number; active?: boolean }): Promise<Tab[]>;
  /** The tab the calling page is shown in. Undefined in the side panel and the service worker. */
  getCurrent(): Promise<Tab | undefined>;
}

export interface WindowsPort {
  /** The window the calling page is in. */
  getCurrent(): Promise<{ id?: number }>;
}

export interface CommandsPort {
  /** Fired when the user presses one of the extension's keyboard shortcuts. `tab` is the active tab. */
  onCommand: BrowserEvent<(command: string, tab?: Tab) => void>;
}

// --- Permissions and content scripts ----------------------------------------------------

export interface Permissions {
  /** Host match patterns, such as `<all_urls>`. */
  origins?: string[];
  permissions?: string[];
}

export interface PermissionsPort {
  /**
   * Asks the user for optional permissions the manifest declares, and resolves with whether
   * they're granted. Chrome allows it only during a user action.
   */
  request(permissions: Permissions): Promise<boolean>;
  contains(permissions: Permissions): Promise<boolean>;
  onAdded: BrowserEvent<(permissions: Permissions) => void>;
  /** Also fired when the user takes access away on Chrome's extensions page. */
  onRemoved: BrowserEvent<(permissions: Permissions) => void>;
}

export interface RegisteredContentScript {
  id: string;
  /** Paths inside the extension. */
  js: string[];
  matches?: string[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  allFrames?: boolean;
  /** Defaults to true: Chrome keeps the registration after the browser restarts. */
  persistAcrossSessions?: boolean;
}

export interface ScriptingPort {
  /**
   * Chrome runs a registered script in every matching page loaded from then on, where the
   * extension has host access. Rejects an ID that is already registered.
   */
  registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
  /** Rejects an ID that isn't registered. Omit `filter` to unregister everything. */
  unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
  getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredContentScript[]>;
  /** Runs files in a tab's page now. Rejects where content scripts can't run, such as chrome:// pages. */
  executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<unknown[]>;
}

// --- The port ----------------------------------------------------------------------------

export interface BrowserPort {
  bookmarks: BookmarksPort;
  storage: StoragePort;
  runtime: RuntimePort;
  i18n: I18nPort;
  sidePanel: SidePanelPort;
  tabs: TabsPort;
  windows: WindowsPort;
  commands: CommandsPort;
  permissions: PermissionsPort;
  scripting: ScriptingPort;
}
