import { useEffect, useId, useRef, useState } from 'react';
import type { OpenPinnedTab, TodayTab } from '../core/sidebar-protocol';
import type { Favorite, Space } from '../library/structure';
import { type RunCommand, useBrowser, useCore, useMessages } from './browser-context';
import { faviconUrl } from './favicon';
import { Settings } from './Settings';
import { NewSpaceForm, SpaceEditor, spaceColorStyle } from './space-forms';
import { SpaceSwitcher } from './SpaceSwitcher';
import { SpaceTabs } from './SpaceTabs';

/** The sidebar of one window. It shows that window's Active Space. */
export function Sidebar({ windowId }: { windowId: number }) {
  const t = useMessages();
  const { state, run } = useCore(windowId);
  const [creating, setCreating] = useState(false);
  /** A control in the Space switcher to focus once it's drawn, after the new Space form closes. */
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  useEffect(() => {
    if (focusTarget === null) return;
    document.querySelector<HTMLElement>(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget, state]);

  if (state.status === 'loading') return <p className="status">{t('loading')}</p>;
  if (state.status === 'error') {
    return (
      <p className="status" role="alert">
        {t('libraryError')}
      </p>
    );
  }

  const { view } = state;
  const activeSpace = view.spaces.find((space) => space.id === view.activeSpaceId) ?? view.spaces[0];
  return (
    <div className="sidebar">
      {!view.syncing && <NotSyncingNotice />}
      <FavoritesRow favorites={view.favorites} />
      <main className="space">
        {creating ? (
          <NewSpaceForm
            spaces={view.spaces}
            run={run}
            onCreated={(spaceId) => {
              // A new Space becomes the window's Active Space, with a new tab in its group.
              void run({ type: 'switchSpace', spaceId });
              setCreating(false);
              setFocusTarget(`[data-space-id="${CSS.escape(spaceId)}"]`);
            }}
            onCancel={() => {
              setCreating(false);
              setFocusTarget('[data-new-space]');
            }}
          />
        ) : (
          activeSpace && (
            <SpaceContents
              key={activeSpace.id}
              space={activeSpace}
              openPinnedTabs={view.openPinnedTabs}
              todayTabs={view.todayTabs}
              run={run}
            />
          )
        )}
      </main>
      <SpaceSwitcher
        spaces={view.spaces}
        activeSpaceId={activeSpace?.id}
        creating={creating}
        run={run}
        onSelect={() => setCreating(false)}
        onCreate={() => setCreating(true)}
      />
      <Settings />
    </div>
  );
}

function NotSyncingNotice() {
  const t = useMessages();
  return (
    <section className="notice" role="status">
      <strong>{t('notSyncingTitle')}</strong>
      <p>{t('notSyncingBody')}</p>
    </section>
  );
}

function FavoritesRow({ favorites }: { favorites: Favorite[] }) {
  const t = useMessages();
  const { runtime } = useBrowser();
  if (favorites.length === 0) return null;
  return (
    <ul className="favorites" aria-label={t('favoritesLabel')}>
      {favorites.map((favorite) => {
        const label = favorite.title || favorite.url;
        return (
          <li key={favorite.id} className="favorite" title={label}>
            <img src={faviconUrl(runtime, favorite.url)} alt={label} width={20} height={20} />
          </li>
        );
      })}
    </ul>
  );
}

function SpaceContents({
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
  const [editing, setEditing] = useState(false);
  const editorId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  return (
    <>
      <header className="space-header" style={spaceColorStyle(space.color)}>
        <span className="color-dot" aria-hidden="true" />
        <h1 className="space-name">{space.name}</h1>
        <button
          ref={editButton}
          type="button"
          className="icon-button"
          title={t('editSpace')}
          aria-label={t('editSpace')}
          aria-expanded={editing}
          aria-controls={editing ? editorId : undefined}
          onClick={() => setEditing(!editing)}
        >
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
            <path d="M10.8 2.7l2.5 2.5-7.6 7.6-3.2.7.7-3.2z" />
          </svg>
        </button>
      </header>
      {editing && (
        <SpaceEditor
          id={editorId}
          space={space}
          run={run}
          onDone={() => {
            setEditing(false);
            editButton.current?.focus();
          }}
        />
      )}
      <SpaceTabs space={space} openPinnedTabs={openPinnedTabs} todayTabs={todayTabs} run={run} />
    </>
  );
}
