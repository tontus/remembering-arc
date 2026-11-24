import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS as DndCss } from '@dnd-kit/utilities';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Space } from '../library/structure';
import { type RunCommand, useMessages } from './browser-context';
import { commandErrorMessage, spaceColorStyle } from './space-forms';

/**
 * The row of Space icons at the bottom of the sidebar. Clicking an icon makes that Space the
 * window's Active Space. Dragging one, or Alt and an arrow key, moves it among the Spaces.
 */
export function SpaceSwitcher({
  spaces,
  activeSpaceId,
  creating,
  run,
  onSelect,
  onCreate,
}: {
  spaces: Space[];
  activeSpaceId: string | undefined;
  creating: boolean;
  run: RunCommand;
  /** Called when the user picks a Space, as the core starts switching to it. */
  onSelect: (spaceId: string) => void;
  onCreate: () => void;
}) {
  const t = useMessages();
  // A move shows at once, before the core sends the view that has it.
  const [movedOrder, setMovedOrder] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const refocus = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => setMovedOrder(null), [spaces]);
  // Moving an icon can take its focus away. Give it back.
  useLayoutEffect(() => {
    if (refocus.current === null) return;
    list.current?.querySelector<HTMLElement>(`[data-space-id="${globalThis.CSS.escape(refocus.current)}"]`)?.focus();
    refocus.current = null;
  });

  const byId = new Map(spaces.map((space) => [space.id, space]));
  const order = (movedOrder ?? spaces.map((space) => space.id)).filter((id) => byId.has(id));
  const nameOf = (id: UniqueIdentifier) => byId.get(String(id))?.name ?? '';
  const positionOf = (id: UniqueIdentifier) => String(order.indexOf(String(id)) + 1);
  const count = String(order.length);

  const move = (spaceId: string, toIndex: number): boolean => {
    const from = order.indexOf(spaceId);
    if (from === -1 || toIndex === from || toIndex < 0 || toIndex >= order.length) return false;
    setMovedOrder(arrayMove(order, from, toIndex));
    setError(null);
    run({ type: 'moveSpace', spaceId, toIndex }).then((outcome) => {
      if (outcome.ok) return;
      setMovedOrder(null);
      setError(commandErrorMessage(t, outcome));
    });
    return true;
  };

  const select = (spaceId: string) => {
    setError(null);
    onSelect(spaceId);
    run({ type: 'switchSpace', spaceId }).then((outcome) => {
      if (!outcome.ok) setError(commandErrorMessage(t, outcome));
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over) move(String(active.id), order.indexOf(String(over.id)));
  };

  const onKeyMove = (spaceId: string, step: -1 | 1) => {
    const toIndex = order.indexOf(spaceId) + step;
    if (!move(spaceId, toIndex)) return;
    refocus.current = spaceId;
    setAnnouncement(t('spaceMoved', [nameOf(spaceId), String(toIndex + 1), count]));
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => t('spacePickedUp', nameOf(active.id)),
    onDragOver: ({ active, over }) =>
      over ? t('spaceMovingOver', [nameOf(active.id), positionOf(over.id), count]) : undefined,
    onDragEnd: ({ active, over }) =>
      over && over.id !== active.id
        ? t('spaceMoved', [nameOf(active.id), positionOf(over.id), count])
        : t('spaceMoveCancelled', nameOf(active.id)),
    onDragCancel: ({ active }) => t('spaceMoveCancelled', nameOf(active.id)),
  };

  return (
    <nav className="space-switcher" aria-label={t('spaceSwitcherLabel')}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t('moveSpaceHint') } }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <ul ref={list}>
            {order.map((id) => (
              <SpaceIcon
                key={id}
                space={byId.get(id)!}
                active={!creating && id === activeSpaceId}
                onSelect={select}
                onKeyMove={onKeyMove}
              />
            ))}
            <li>
              <button
                type="button"
                className="space-icon new-space"
                data-new-space=""
                title={t('newSpace')}
                aria-label={t('newSpace')}
                aria-pressed={creating}
                onClick={onCreate}
              >
                <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
                  <path d="M8 2.5v11M2.5 8h11" />
                </svg>
              </button>
            </li>
          </ul>
        </SortableContext>
      </DndContext>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </nav>
  );
}

function SpaceIcon({
  space,
  active,
  onSelect,
  onKeyMove,
}: {
  space: Space;
  active: boolean;
  onSelect: (spaceId: string) => void;
  onKeyMove: (spaceId: string, step: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: space.id });

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    // In a right-to-left language the row runs from the right.
    const rightToLeft = getComputedStyle(event.currentTarget).direction === 'rtl';
    onKeyMove(space.id, (event.key === 'ArrowRight') !== rightToLeft ? 1 : -1);
  };

  return (
    <li
      ref={setNodeRef}
      className={isDragging ? 'dragging' : undefined}
      style={{ transform: DndCss.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="space-icon"
        data-space-id={space.id}
        style={spaceColorStyle(space.color)}
        title={space.name}
        aria-label={space.name}
        aria-pressed={active}
        // dnd-kit's default ("sortable") isn't translated, and "button" says enough.
        aria-roledescription={undefined}
        onClick={() => onSelect(space.id)}
        onKeyDown={onKeyDown}
      >
        {space.icon ?? <span className="initial">{Array.from(space.label.trim())[0] ?? ''}</span>}
        <span className="color-mark" aria-hidden="true" />
      </button>
    </li>
  );
}
