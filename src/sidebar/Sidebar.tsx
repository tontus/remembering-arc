import { useState } from 'react';
import type { Favorite, Folder, PinnedTab, Space, SpaceItem } from '../library/structure';
import { useBrowser, useMessages, useSidebarState } from './browser-context';
import { faviconUrl } from './favicon';

export function Sidebar() {
  const t = useMessages();
  const state = useSidebarState();
  // The Active Space lives only in this sidebar for now, so it resets when the panel reopens.
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);

  if (state.status === 'loading') return <p className="status">{t('loading')}</p>;
  if (state.status === 'error') {
    return (
      <p className="status" role="alert">
        {t('libraryError')}
      </p>
    );
  }

  const { view } = state;
  const activeSpace = view.spaces.find((space) => space.id === activeSpaceId) ?? view.spaces[0];
  return (
    <div className="sidebar">
      {!view.syncing && <NotSyncingNotice />}
      <FavoritesRow favorites={view.favorites} />
      <main className="space">{activeSpace && <SpaceContents space={activeSpace} />}</main>
      <SpaceSwitcher spaces={view.spaces} activeSpaceId={activeSpace?.id} onSelect={setActiveSpaceId} />
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

function SpaceContents({ space }: { space: Space }) {
  const t = useMessages();
  return (
    <>
      <h1 className="space-name">{space.name}</h1>
      {space.items.length === 0 ? (
        <p className="empty">{t('emptySpace')}</p>
      ) : (
        <SpaceItems items={space.items} label={t('pinnedTabsLabel')} />
      )}
    </>
  );
}

function SpaceItems({ items, label }: { items: SpaceItem[]; label?: string }) {
  return (
    <ul className="items" aria-label={label}>
      {items.map((item) =>
        item.kind === 'folder' ? (
          <FolderRow key={item.id} folder={item} />
        ) : (
          <PinnedTabRow key={item.id} pinnedTab={item} />
        ),
      )}
    </ul>
  );
}

function PinnedTabRow({ pinnedTab }: { pinnedTab: PinnedTab }) {
  const { runtime } = useBrowser();
  return (
    <li className="pinned-tab" title={pinnedTab.pinnedUrl}>
      <img src={faviconUrl(runtime, pinnedTab.pinnedUrl)} alt="" width={16} height={16} />
      <span className="label">{pinnedTab.title || pinnedTab.pinnedUrl}</span>
    </li>
  );
}

function FolderRow({ folder }: { folder: Folder }) {
  return (
    <li className="folder">
      <div className="folder-name">
        <svg className="folder-icon" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
          <path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
        </svg>
        <span className="label">{folder.name}</span>
      </div>
      {folder.items.length > 0 && <SpaceItems items={folder.items} />}
    </li>
  );
}

function SpaceSwitcher({
  spaces,
  activeSpaceId,
  onSelect,
}: {
  spaces: Space[];
  activeSpaceId: string | undefined;
  onSelect: (spaceId: string) => void;
}) {
  const t = useMessages();
  return (
    <nav className="space-switcher" aria-label={t('spaceSwitcherLabel')}>
      <ul>
        {spaces.map((space) => (
          <li key={space.id}>
            <button
              type="button"
              className="space-icon"
              title={space.name}
              aria-label={space.name}
              aria-pressed={space.id === activeSpaceId}
              onClick={() => onSelect(space.id)}
            >
              {space.icon ?? <span className="initial">{Array.from(space.name.trim())[0] ?? ''}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
