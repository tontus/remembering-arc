import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useId, useState } from 'react';
import type { OpenPinnedTab, SidebarCommand, TodayTab } from '../core/sidebar-protocol';
import type { Folder, PinnedTab, Space, SpaceItem } from '../library/structure';
import { type RunCommand, useBrowser, useMessages } from './browser-context';
import { useContextMenu } from './context-menu';
import { faviconUrl } from './favicon';
import { commandErrorMessage, spaceColorStyle } from './space-forms';

/** Sends a command, showing the user a message if it fails. */
type Send = (command: SidebarCommand) => void;

const PINNED_SECTION = 'pinned-section';

/**
 * The Active Space's Pinned tabs and Folders, then its Today tabs. Clicking a Pinned tab
 * opens it, or switches to its open tab. Dragging a Today tab in among the Pinned tabs, or
 * choosing Pin from its menu, pins it.
 */
export function SpaceTabs({
  space,
  openPinnedTabs,
  todayTabs,
  run,
}: {
  space: Space;
  openPinnedTabs: Record<string, OpenPinnedTab>;
  todayTabs: TodayTab[];
  run: RunCommand;
}) {
  const t = useMessages();
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<TodayTab | null>(null);
  /** Where a Today tab being dragged would land among the Pinned tabs and Folders. */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const send: Send = (command) => {
    setError(null);
    void run(command).then((outcome) => {
      if (!outcome.ok) setError(commandErrorMessage(t, outcome));
    });
  };

  /** The position among the Space's top-level Pinned tabs and Folders under the pointer. */
  const indexAt = ({ over, activatorEvent, delta }: DragMoveEvent | DragEndEvent): number | null => {
    if (!over) return null;
    if (over.id === PINNED_SECTION) return space.items.length;
    const index = (over.data.current as { index?: number } | undefined)?.index;
    if (index === undefined) return null;
    const pointerY = (activatorEvent as PointerEvent).clientY + delta.y;
    return pointerY < over.rect.top + over.rect.height / 2 ? index : index + 1;
  };

  const draggedTitle = (data: unknown) => (data as { tab?: TodayTab } | undefined)?.tab?.title ?? '';
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('tabPickedUp', draggedTitle(active.data.current)),
    onDragOver: () => undefined,
    onDragEnd: ({ active, over }) =>
      over ? t('tabPinnedAnnouncement', draggedTitle(active.data.current)) : t('tabNotPinned', draggedTitle(active.data.current)),
    onDragCancel: ({ active }) => t('tabNotPinned', draggedTitle(active.data.current)),
  };

  const endDrag = () => {
    setDragged(null);
    setDropIndex(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pinnedSectionCollision}
      accessibility={{ announcements, screenReaderInstructions: { draggable: '' } }}
      onDragStart={({ active }) => setDragged((active.data.current as { tab: TodayTab }).tab)}
      onDragMove={(event) => setDropIndex(indexAt(event))}
      onDragEnd={(event) => {
        const index = indexAt(event);
        const tab = (event.active.data.current as { tab: TodayTab }).tab;
        endDrag();
        if (index !== null) send({ type: 'pinTab', tabId: tab.id, toIndex: index });
      }}
      onDragCancel={endDrag}
    >
      {error && (
        <p className="form-error tabs-error" role="alert">
          {error}
        </p>
      )}
      <PinnedSection space={space} openPinnedTabs={openPinnedTabs} dropIndex={dropIndex} send={send} />
      {todayTabs.length > 0 && (
        <ul className="today-tabs" aria-label={t('todayTabsLabel')}>
          {todayTabs.map((tab) => (
            <TodayTabRow key={tab.id} tab={tab} dragging={dragged?.id === tab.id} send={send} />
          ))}
        </ul>
      )}
      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className="tab-row drag-preview">
            <TabLabel url={dragged.url} title={dragged.title} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * A Today tab dropped anywhere in the Pinned section lands next to the nearest top-level
 * Pinned tab or Folder, or in the empty section.
 */
const pinnedSectionCollision: CollisionDetection = ({ droppableContainers, droppableRects, pointerCoordinates }) => {
  const section = droppableContainers.find((container) => container.id === PINNED_SECTION);
  const sectionRect = droppableRects.get(PINNED_SECTION);
  if (!section || !sectionRect || !pointerCoordinates) return [];
  const { x, y } = pointerCoordinates;
  if (x < sectionRect.left || x > sectionRect.right || y < sectionRect.top || y > sectionRect.bottom) return [];

  let nearest = section;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id);
    if (container === section || !rect) continue;
    const distance = Math.abs(y - (rect.top + rect.height / 2));
    if (distance < nearestDistance) {
      nearest = container;
      nearestDistance = distance;
    }
  }
  return [{ id: nearest.id, data: { droppableContainer: nearest, value: nearestDistance } }];
};

function PinnedSection({
  space,
  openPinnedTabs,
  dropIndex,
  send,
}: {
  space: Space;
  openPinnedTabs: Record<string, OpenPinnedTab>;
  dropIndex: number | null;
  send: Send;
}) {
  const t = useMessages();
  const { setNodeRef } = useDroppable({ id: PINNED_SECTION });
  const empty = space.items.length === 0;
  return (
    <div
      ref={setNodeRef}
      className={`pinned${empty && dropIndex !== null ? ' drop-target' : ''}`}
      style={spaceColorStyle(space.color)}
    >
      {empty ? (
        <p className="empty">{t('emptySpace')}</p>
      ) : (
        <SpaceItems
          items={space.items}
          label={t('pinnedTabsLabel')}
          openPinnedTabs={openPinnedTabs}
          send={send}
          dropIndex={dropIndex}
        />
      )}
    </div>
  );
}

/**
 * Pinned tabs and Folders in bookmark order. `dropIndex` is given only for the Space's own
 * items, where Today tabs can be dropped.
 */
function SpaceItems({
  items,
  label,
  openPinnedTabs,
  send,
  dropIndex,
}: {
  items: SpaceItem[];
  label?: string;
  openPinnedTabs: Record<string, OpenPinnedTab>;
  send: Send;
  dropIndex?: number | null;
}) {
  const topLevel = dropIndex !== undefined;
  return (
    <ul className="items" aria-label={label}>
      {items.map((item, index) => {
        const drop = topLevel
          ? { index, before: dropIndex === index, after: index === items.length - 1 && dropIndex === items.length }
          : undefined;
        return item.kind === 'folder' ? (
          <FolderRow key={item.id} folder={item} openPinnedTabs={openPinnedTabs} send={send} drop={drop} />
        ) : (
          <PinnedTabRow key={item.id} pinnedTab={item} open={openPinnedTabs[item.id]} send={send} drop={drop} />
        );
      })}
    </ul>
  );
}

/** Where a top-level row sits, and whether a dragged Today tab would land just before or after it. */
interface RowDrop {
  index: number;
  before: boolean;
  after: boolean;
}

function useRowDropTarget(id: string, drop: RowDrop | undefined) {
  const { setNodeRef } = useDroppable({ id: `pinned-item:${id}`, disabled: !drop, data: { index: drop?.index } });
  const className = drop?.before ? ' drop-before' : drop?.after ? ' drop-after' : '';
  return { setNodeRef, className };
}

function PinnedTabRow({
  pinnedTab,
  open,
  send,
  drop,
}: {
  pinnedTab: PinnedTab;
  open: OpenPinnedTab | undefined;
  send: Send;
  drop: RowDrop | undefined;
}) {
  const t = useMessages();
  const target = useRowDropTarget(pinnedTab.id, drop);
  const label = pinnedTab.title || pinnedTab.pinnedUrl;
  const { onContextMenu, menu } = useContextMenu(label, [
    { label: t('unpinTab'), onSelect: () => send({ type: 'unpin', pinnedTabId: pinnedTab.id }) },
  ]);
  const state = !open ? 'closed' : open.wandered ? 'wandered' : 'open';
  const wanderedTo = open?.wandered ? t('pinnedTabWandered', open.title) : undefined;
  // Read out after the name: whether it's open, and where its tab has gone.
  const stateText = wanderedTo ?? (open ? undefined : t('pinnedTabNotOpen'));
  const stateId = useId();

  return (
    <li ref={target.setNodeRef} className={`pinned-tab${target.className}`} data-state={state}>
      <button
        type="button"
        className="tab-row"
        title={wanderedTo ?? pinnedTab.pinnedUrl}
        aria-current={open?.active ? 'page' : undefined}
        aria-describedby={stateText ? stateId : undefined}
        onClick={() => send({ type: 'openPinnedTab', pinnedTabId: pinnedTab.id })}
        onContextMenu={onContextMenu}
      >
        <TabLabel url={pinnedTab.pinnedUrl} title={label} />
      </button>
      {stateText && (
        <span id={stateId} className="visually-hidden">
          {stateText}
        </span>
      )}
      {open?.wandered && (
        <button
          type="button"
          className="icon-button return-button"
          title={t('returnToPinnedUrl')}
          aria-label={t('returnToPinnedUrl')}
          onClick={() => send({ type: 'returnToPinnedUrl', pinnedTabId: pinnedTab.id })}
        >
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
            <path d="M6 3.5 2.5 7 6 10.5M3 7h6.5a4 4 0 0 1 0 8H8" />
          </svg>
        </button>
      )}
      {menu}
    </li>
  );
}

function FolderRow({
  folder,
  openPinnedTabs,
  send,
  drop,
}: {
  folder: Folder;
  openPinnedTabs: Record<string, OpenPinnedTab>;
  send: Send;
  drop: RowDrop | undefined;
}) {
  const target = useRowDropTarget(folder.id, drop);
  return (
    <li ref={target.setNodeRef} className={`folder${target.className}`}>
      <div className="folder-name">
        <svg className="folder-icon" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
          <path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
        </svg>
        <span className="label">{folder.name}</span>
      </div>
      {folder.items.length > 0 && <SpaceItems items={folder.items} openPinnedTabs={openPinnedTabs} send={send} />}
    </li>
  );
}

/** A Today tab. Clicking it activates it; dragging it among the Pinned tabs pins it. */
function TodayTabRow({ tab, dragging, send }: { tab: TodayTab; dragging: boolean; send: Send }) {
  const t = useMessages();
  // Only pointer dragging: from the keyboard, Pin is in the tab's menu.
  const { setNodeRef, listeners } = useDraggable({ id: `today-tab:${tab.id}`, data: { tab } });
  const { onContextMenu, menu } = useContextMenu(tab.title, [
    { label: t('pinTab'), onSelect: () => send({ type: 'pinTab', tabId: tab.id }) },
  ]);
  return (
    <li className={dragging ? 'dragging' : undefined}>
      <button
        ref={setNodeRef}
        {...listeners}
        type="button"
        className="tab-row today-tab"
        title={tab.url}
        aria-current={tab.active ? 'page' : undefined}
        onClick={() => send({ type: 'activateTab', tabId: tab.id })}
        onContextMenu={onContextMenu}
      >
        <TabLabel url={tab.url} title={tab.title} />
      </button>
      {menu}
    </li>
  );
}

function TabLabel({ url, title }: { url: string; title: string }) {
  const { runtime } = useBrowser();
  return (
    <>
      <img src={faviconUrl(runtime, url)} alt="" width={16} height={16} />
      <span className="label">{title}</span>
    </>
  );
}
