import { type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  onSelect: () => void;
}

/**
 * A menu that opens where the user right-clicks a row, or below the row when they press the
 * context menu key or Shift+F10. Spread `onContextMenu` on the row's button and render
 * `menu` next to it.
 */
export function useContextMenu(label: string, items: MenuItem[]): {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  menu: ReactNode;
} {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    trigger.current = event.currentTarget;
    // From the keyboard, the event may carry no position.
    if (event.clientX === 0 && event.clientY === 0) {
      const row = event.currentTarget.getBoundingClientRect();
      setPosition({ x: row.left + 8, y: row.bottom });
    } else {
      setPosition({ x: event.clientX, y: event.clientY });
    }
  };

  const close = useCallback((refocus: boolean) => {
    setPosition(null);
    if (refocus) trigger.current?.focus();
  }, []);

  return {
    onContextMenu,
    menu: position && <ContextMenu label={label} position={position} items={items} onClose={close} />,
  };
}

function ContextMenu({
  label,
  position,
  items,
  onClose,
}: {
  label: string;
  position: { x: number; y: number };
  items: MenuItem[];
  onClose: (refocus: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  // Keep the menu inside the sidebar, and put focus on its first item.
  useLayoutEffect(() => {
    const element = menu.current!;
    const { width, height } = element.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(position.x, window.innerWidth - width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(position.y, window.innerHeight - height - 4))}px`;
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [position]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose(false);
    };
    const dismiss = () => onClose(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose(true);
      return;
    }
    const menuItems = [...menu.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const current = menuItems.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: menuItems.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    menuItems[(next + menuItems.length) % menuItems.length]?.focus();
  };

  return createPortal(
    <div ref={menu} role="menu" aria-label={label} className="context-menu" onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            onClose(true);
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
