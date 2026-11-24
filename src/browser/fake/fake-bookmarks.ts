import type {
  BookmarkChangeInfo,
  BookmarkChanges,
  BookmarkCreateDetails,
  BookmarkDestination,
  BookmarkFolderType,
  BookmarkMoveInfo,
  BookmarkNode,
  BookmarkRemoveInfo,
  BookmarkReorderInfo,
  BookmarksPort,
} from '../port';
import { FakeEvent } from './fake-event';

/** How the fake Chrome profile stores and syncs bookmarks. */
export type BookmarkSync =
  /** Signed out: one local tree, which doesn't sync. */
  | 'off'
  /** Signed in with account storage: a local tree that doesn't sync, and an account tree that does. */
  | 'account'
  /** Signed in with Chrome's older full sync: one local tree, which syncs. */
  | 'legacy';

/** Bookmarks and folders to add in one call when setting up a test. */
export type BookmarkTreeSpec =
  | { title: string; url: string }
  | { title: string; children: BookmarkTreeSpec[] };

/** A folder's contents without IDs or dates, for assertions. */
export type BookmarkShape =
  | { title: string; url: string }
  | { title: string; children: BookmarkShape[] };

interface StoredNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  dateAdded: number;
  dateGroupModified?: number;
  folderType?: BookmarkFolderType;
  /** Set on the root and on the folders Chrome adds. Every other node takes its tree's value. */
  syncing?: boolean;
  /** Child IDs in bookmark order. Folders only. */
  children?: string[];
}

const ROOT_ID = '0';

const PERMANENT_FOLDERS: { folderType: BookmarkFolderType; title: string }[] = [
  { folderType: 'bookmarks-bar', title: 'Bookmarks bar' },
  { folderType: 'other', title: 'Other bookmarks' },
  { folderType: 'mobile', title: 'Mobile bookmarks' },
];

/**
 * In-memory `chrome.bookmarks`, modelled on Chrome 134+: the folders Chrome adds carry a
 * `folderType`, every node carries `syncing`, and a signed-in profile can hold separate
 * local and account trees. Calls validate and fail like Chrome's, and fire the same events.
 *
 * Calling these methods from a test stands in for changes made elsewhere: in Chrome's
 * bookmark manager, or on another device and delivered by sync. Chrome fires the same
 * events for those as for the extension's own calls.
 */
export class FakeBookmarks implements BookmarksPort {
  readonly onCreated = new FakeEvent<(id: string, node: BookmarkNode) => void>();
  readonly onRemoved = new FakeEvent<(id: string, info: BookmarkRemoveInfo) => void>();
  readonly onChanged = new FakeEvent<(id: string, info: BookmarkChangeInfo) => void>();
  readonly onMoved = new FakeEvent<(id: string, info: BookmarkMoveInfo) => void>();
  readonly onChildrenReordered = new FakeEvent<(id: string, info: BookmarkReorderInfo) => void>();

  readonly #nodes = new Map<string, StoredNode>();
  #nextId = 1;
  #lastTime = 0;

  constructor(sync: BookmarkSync) {
    const now = this.#now();
    this.#nodes.set(ROOT_ID, { id: ROOT_ID, title: '', dateAdded: now, syncing: false, children: [] });
    this.#addPermanentFolders({ syncing: sync === 'legacy' });
    if (sync === 'account') this.#addPermanentFolders({ syncing: true });
  }

  // --- chrome.bookmarks ------------------------------------------------------------------

  async getTree(): Promise<BookmarkNode[]> {
    return [this.#toNode(this.#get(ROOT_ID), { withChildren: true })];
  }

  /** Without a `parentId`, creates in the local "Other bookmarks", as Chrome does. */
  async create(details: BookmarkCreateDetails): Promise<BookmarkNode> {
    const parent = this.#getParent(details.parentId ?? this.permanentFolderId('other', { local: true }));
    const siblings = this.#childrenOf(parent);
    const index = details.index ?? siblings.length;
    if (!Number.isInteger(index) || index < 0 || index > siblings.length) {
      throw new Error('Index out of bounds.');
    }
    if (details.url !== undefined && !URL.canParse(details.url)) throw new Error('Invalid URL.');

    const now = this.#now();
    const node: StoredNode = {
      id: String(this.#nextId++),
      parentId: parent.id,
      title: details.title ?? '',
      dateAdded: now,
      ...(details.url === undefined ? { children: [], dateGroupModified: now } : { url: details.url }),
    };
    this.#nodes.set(node.id, node);
    siblings.splice(index, 0, node.id);
    parent.dateGroupModified = now;

    this.onCreated.dispatch(node.id, this.#toNode(node));
    return this.#toNode(node);
  }

  async update(id: string, changes: BookmarkChanges): Promise<BookmarkNode> {
    const node = this.#getModifiable(id);
    if (changes.url !== undefined) {
      if (node.url === undefined) throw new Error("Can't set URL of a bookmark folder.");
      if (!URL.canParse(changes.url)) throw new Error('Invalid URL.');
    }

    const titleChanged = changes.title !== undefined && changes.title !== node.title;
    const urlChanged = changes.url !== undefined && changes.url !== node.url;
    if (titleChanged) node.title = changes.title!;
    if (urlChanged) node.url = changes.url!;
    if (titleChanged || urlChanged) {
      this.onChanged.dispatch(id, node.url === undefined ? { title: node.title } : { title: node.title, url: node.url });
    }
    return this.#toNode(node);
  }

  /**
   * Like Chrome, `index` is a position in the destination folder as it is before the node
   * leaves it, so moving a node later within its own folder lands it one place earlier.
   */
  async move(id: string, destination: BookmarkDestination): Promise<BookmarkNode> {
    const node = this.#getModifiable(id);
    const oldParent = this.#get(node.parentId!);
    const oldSiblings = this.#childrenOf(oldParent);
    const oldIndex = oldSiblings.indexOf(id);
    const newParent = this.#getParent(destination.parentId ?? oldParent.id);
    const newSiblings = this.#childrenOf(newParent);
    if (this.#isSelfOrAncestor(id, newParent.id)) {
      throw new Error("Can't move a folder into itself or one of its descendants.");
    }
    let index = destination.index ?? newSiblings.length;
    if (!Number.isInteger(index) || index < 0 || index > newSiblings.length) {
      throw new Error('Index out of bounds.');
    }
    if (newParent === oldParent) {
      if (index === oldIndex || index === oldIndex + 1) return this.#toNode(node);
      if (index > oldIndex) index--;
    }

    const now = this.#now();
    oldSiblings.splice(oldIndex, 1);
    newSiblings.splice(index, 0, id);
    node.parentId = newParent.id;
    oldParent.dateGroupModified = now;
    newParent.dateGroupModified = now;

    this.onMoved.dispatch(id, { parentId: newParent.id, index, oldParentId: oldParent.id, oldIndex });
    return this.#toNode(node);
  }

  async remove(id: string): Promise<void> {
    const node = this.#getModifiable(id);
    if (node.children && node.children.length > 0) {
      throw new Error("Can't remove non-empty folder (use recursive to force).");
    }
    this.#detach(node);
  }

  async removeTree(id: string): Promise<void> {
    this.#detach(this.#getModifiable(id));
  }

  // --- Test controls ---------------------------------------------------------------------

  /** Reorders a folder's children, as "Sort by name" in Chrome's bookmark manager does. */
  reorderChildren(folderId: string, childIds: string[]): void {
    const folder = this.#get(folderId);
    const current = this.#childrenOf(folder);
    if (childIds.length !== current.length || !childIds.every((childId) => current.includes(childId))) {
      throw new Error('childIds must list every child of the folder exactly once.');
    }
    folder.children = [...childIds];
    this.onChildrenReordered.dispatch(folderId, { childIds: [...childIds] });
  }

  /**
   * The ID of a folder Chrome adds, such as "Other bookmarks": the one in the account tree
   * (`syncing: true`) or the one in the local tree (`local: true`).
   */
  permanentFolderId(folderType: BookmarkFolderType, which: { syncing: true } | { local: true }): string {
    const candidates = this.#childrenOf(this.#get(ROOT_ID))
      .map((id) => this.#get(id))
      .filter((node) => node.folderType === folderType);
    // The local tree is created first, so it comes first.
    const node = 'local' in which ? candidates[0] : candidates.find((candidate) => candidate.syncing);
    if (!node) throw new Error(`This profile has no ${'local' in which ? 'local' : 'syncing'} "${folderType}" folder.`);
    return node.id;
  }

  /** Adds bookmarks and folders to the end of a folder, in order. Returns the new top-level IDs. */
  async addTree(parentId: string, specs: BookmarkTreeSpec[]): Promise<string[]> {
    const ids: string[] = [];
    for (const spec of specs) {
      if ('url' in spec) {
        ids.push((await this.create({ parentId, title: spec.title, url: spec.url })).id);
      } else {
        const folder = await this.create({ parentId, title: spec.title });
        await this.addTree(folder.id, spec.children);
        ids.push(folder.id);
      }
    }
    return ids;
  }

  /** A folder's contents as titles, URLs and nested children. */
  shape(folderId: string): BookmarkShape[] {
    return this.#childrenOf(this.#get(folderId)).map((id) => {
      const node = this.#get(id);
      return node.url === undefined
        ? { title: node.title, children: this.shape(id) }
        : { title: node.title, url: node.url };
    });
  }

  // --- Internals -------------------------------------------------------------------------

  #addPermanentFolders({ syncing }: { syncing: boolean }): void {
    const root = this.#get(ROOT_ID);
    for (const { folderType, title } of PERMANENT_FOLDERS) {
      const now = this.#now();
      const node: StoredNode = {
        id: String(this.#nextId++),
        parentId: ROOT_ID,
        title,
        dateAdded: now,
        dateGroupModified: now,
        folderType,
        syncing,
        children: [],
      };
      this.#nodes.set(node.id, node);
      root.children!.push(node.id);
    }
  }

  /** Dates strictly increase, so "oldest" is never a tie. */
  #now(): number {
    this.#lastTime = Math.max(Date.now(), this.#lastTime + 1);
    return this.#lastTime;
  }

  #get(id: string): StoredNode {
    const node = this.#nodes.get(id);
    if (!node) throw new Error("Can't find bookmark for id.");
    return node;
  }

  #getParent(id: string): StoredNode {
    const parent = this.#nodes.get(id);
    if (!parent) throw new Error("Can't find parent bookmark for id.");
    if (!parent.children) throw new Error("Parameter 'parentId' does not specify a folder.");
    if (parent.id === ROOT_ID) throw new Error("Can't modify the root bookmark folders.");
    return parent;
  }

  /** A node the extension may change: not the root or a folder Chrome adds. */
  #getModifiable(id: string): StoredNode {
    const node = this.#get(id);
    if (node.id === ROOT_ID || node.folderType !== undefined) {
      throw new Error("Can't modify the root bookmark folders.");
    }
    return node;
  }

  #childrenOf(folder: StoredNode): string[] {
    if (!folder.children) throw new Error("Parameter 'parentId' does not specify a folder.");
    return folder.children;
  }

  #isSelfOrAncestor(candidateId: string, nodeId: string): boolean {
    for (let id: string | undefined = nodeId; id !== undefined; id = this.#nodes.get(id)?.parentId) {
      if (id === candidateId) return true;
    }
    return false;
  }

  #isSyncing(node: StoredNode): boolean {
    let current: StoredNode | undefined = node;
    while (current && current.syncing === undefined) {
      current = current.parentId === undefined ? undefined : this.#nodes.get(current.parentId);
    }
    return current?.syncing ?? false;
  }

  #detach(node: StoredNode): void {
    const parent = this.#get(node.parentId!);
    const siblings = this.#childrenOf(parent);
    const index = siblings.indexOf(node.id);
    const removed = this.#toNode(node, { withChildren: true });
    siblings.splice(index, 1);
    parent.dateGroupModified = this.#now();
    this.#forget(node);
    this.onRemoved.dispatch(node.id, { parentId: parent.id, index, node: removed });
  }

  #forget(node: StoredNode): void {
    for (const childId of node.children ?? []) this.#forget(this.#get(childId));
    this.#nodes.delete(node.id);
  }

  #toNode(node: StoredNode, { withChildren = false } = {}): BookmarkNode {
    const result: BookmarkNode = {
      id: node.id,
      title: node.title,
      dateAdded: node.dateAdded,
      syncing: this.#isSyncing(node),
    };
    if (node.parentId !== undefined) {
      result.parentId = node.parentId;
      result.index = this.#childrenOf(this.#get(node.parentId)).indexOf(node.id);
    }
    if (node.url !== undefined) result.url = node.url;
    if (node.dateGroupModified !== undefined) result.dateGroupModified = node.dateGroupModified;
    if (node.folderType !== undefined) result.folderType = node.folderType;
    if (withChildren && node.children) {
      result.children = node.children.map((id) => this.#toNode(this.#get(id), { withChildren: true }));
    }
    return result;
  }
}
