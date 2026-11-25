import { type CSSProperties, type KeyboardEvent, useEffect, useId, useOptimistic, useRef, useState, useTransition } from 'react';
import type { CommandOutcome } from '../core/sidebar-protocol';
import type { MessageKey } from '../i18n';
import { DEFAULT_SPACE_COLOR, SPACE_COLORS, type SpaceColor } from '../library/space-color';
import { isSpaceIcon } from '../library/space-name';
import type { Space } from '../library/structure';
import { type RunCommand, useMessages } from './browser-context';

/** Icons offered first. Any other emoji can be typed in. */
const SUGGESTED_ICONS = ['🏠', '💼', '🚀', '📚', '🎨', '🎮', '🛒', '✈️', '💡', '🎵', '🧪', '📰', '💰', '❤️', '⭐', '🌱'];

const COLOR_NAMES: Record<SpaceColor, MessageKey> = {
  grey: 'colorGrey',
  blue: 'colorBlue',
  red: 'colorRed',
  yellow: 'colorYellow',
  green: 'colorGreen',
  pink: 'colorPink',
  purple: 'colorPurple',
  cyan: 'colorCyan',
  orange: 'colorOrange',
};

type Translate = ReturnType<typeof useMessages>;

/** The CSS color for a Space color, matching Chrome's tab group colors in light and dark mode. */
export function spaceColorStyle(color: SpaceColor): CSSProperties {
  return { '--space-color': `var(--group-${color})` } as CSSProperties;
}

/** The message that tells the user why a command didn't work. */
export function commandErrorMessage(t: Translate, outcome: Extract<CommandOutcome, { ok: false }>): string {
  switch (outcome.reason) {
    case 'duplicate-name':
      return t('spaceNameTaken', outcome.spaceName ?? '');
    case 'empty-name':
      return t('spaceNameEmpty');
    case 'invalid-icon':
      return t('spaceIconInvalid');
    case 'space-not-found':
      return t('spaceNotFound');
    case 'pinned-tab-not-found':
      return t('pinnedTabNotFound');
    case 'invalid-color':
    case 'failed':
      return t('commandFailed');
  }
}

/** The form that creates a Space. */
export function NewSpaceForm({
  spaces,
  run,
  onCreated,
  onCancel,
}: {
  spaces: Space[];
  run: RunCommand;
  onCreated: (spaceId: string) => void;
  onCancel: () => void;
}) {
  const t = useMessages();
  const headingId = useId();
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  // Start with a color no Space has yet, so Spaces are easy to tell apart.
  const [color, setColor] = useState<SpaceColor>(
    () => SPACE_COLORS.find((candidate) => !spaces.some((space) => space.color === candidate)) ?? DEFAULT_SPACE_COLOR,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = () => {
    setBusy(true);
    run({ type: 'createSpace', icon, label, color }).then((outcome) => {
      setBusy(false);
      if (outcome.ok) onCreated(outcome.spaceId!);
      else setError(commandErrorMessage(t, outcome));
    });
  };

  return (
    <form
      className="space-form"
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <h1 id={headingId} className="space-name">
        {t('newSpace')}
      </h1>
      <label className="field">
        <span className="field-label">{t('spaceNameField')}</span>
        <input type="text" value={label} autoFocus onChange={(event) => setLabel(event.currentTarget.value)} />
      </label>
      <IconPicker value={icon} onChange={setIcon} onInvalid={() => setError(t('spaceIconInvalid'))} />
      <ColorPicker value={color} onChange={setColor} />
      <FormError message={error} />
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {t('createSpace')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

/** The form that changes a Space. Each change is saved as soon as it's made. */
export function SpaceEditor({ id, space, run, onDone }: { id: string; space: Space; run: RunCommand; onDone: () => void }) {
  const t = useMessages();
  const [label, setLabel] = useState(space.label);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Shown until the view that has the change arrives, which happens before the command resolves.
  const [icon, setOptimisticIcon] = useOptimistic(space.icon);
  const [color, setOptimisticColor] = useOptimistic(space.color);
  const renaming = useRef<{ label: string; done: Promise<boolean> }>(null);

  // A rename that arrives from elsewhere, or a trimmed name, shows in the field.
  useEffect(() => setLabel(space.label), [space.label]);

  const report = (outcome: CommandOutcome): boolean => {
    setError(outcome.ok ? null : commandErrorMessage(t, outcome));
    return outcome.ok;
  };

  /** Saves the name, unless it's unchanged or already being saved. Resolves with whether it's saved. */
  const saveLabel = (): Promise<boolean> => {
    const trimmed = label.trim();
    if (trimmed === space.label) return Promise.resolve(true);
    if (renaming.current?.label === trimmed) return renaming.current.done;
    const done = run({ type: 'renameSpace', spaceId: space.id, label: trimmed }).then((outcome) => {
      if (renaming.current?.done === done) renaming.current = null;
      return report(outcome);
    });
    renaming.current = { label: trimmed, done };
    return done;
  };

  const changeIcon = (next: string | null) =>
    startTransition(async () => {
      setOptimisticIcon(next);
      report(await run({ type: 'setSpaceIcon', spaceId: space.id, icon: next }));
    });

  const changeColor = (next: SpaceColor) =>
    startTransition(async () => {
      setOptimisticColor(next);
      report(await run({ type: 'setSpaceColor', spaceId: space.id, color: next }));
    });

  return (
    <form
      id={id}
      className="space-form"
      aria-label={t('editSpace')}
      onSubmit={(event) => {
        event.preventDefault();
        void saveLabel().then((saved) => saved && onDone());
      }}
    >
      <label className="field">
        <span className="field-label">{t('spaceNameField')}</span>
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
          onBlur={() => void saveLabel()}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && label !== space.label) {
              event.preventDefault();
              setLabel(space.label);
              setError(null);
            }
          }}
        />
      </label>
      <IconPicker value={icon} onChange={changeIcon} onInvalid={() => setError(t('spaceIconInvalid'))} />
      <ColorPicker value={color} onChange={changeColor} />
      <FormError message={error} />
      <div className="form-actions">
        <button type="submit" className="primary">
          {t('doneEditing')}
        </button>
      </div>
    </form>
  );
}

function FormError({ message }: { message: string | null }) {
  // Kept in the page, so screen readers announce a message when it appears.
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  );
}

function IconPicker({
  value,
  onChange,
  onInvalid,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  onInvalid: () => void;
}) {
  const t = useMessages();
  const name = useId();
  const [other, setOther] = useState('');
  const icons = value === null || SUGGESTED_ICONS.includes(value) ? SUGGESTED_ICONS : [value, ...SUGGESTED_ICONS];

  const pickTyped = () => {
    const typed = other.trim();
    if (typed === '') return;
    if (!isSpaceIcon(typed)) {
      onInvalid();
      return;
    }
    setOther('');
    onChange(typed);
  };

  return (
    <fieldset className="field">
      <legend className="field-label">{t('spaceIconField')}</legend>
      <div className="choices">
        <label className="choice" title={t('noIcon')}>
          <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} />
          <span className="choice-face no-icon" aria-hidden="true" />
          <span className="visually-hidden">{t('noIcon')}</span>
        </label>
        {icons.map((icon) => (
          <label key={icon} className="choice">
            <input type="radio" name={name} checked={value === icon} onChange={() => onChange(icon)} />
            <span className="choice-face">{icon}</span>
          </label>
        ))}
      </div>
      <label className="other-emoji">
        <span>{t('otherEmojiField')}</span>
        <input
          type="text"
          value={other}
          size={4}
          onChange={(event) => setOther(event.currentTarget.value)}
          onBlur={pickTyped}
          onKeyDown={(event: KeyboardEvent) => {
            // Enter picks the emoji rather than submitting the form.
            if (event.key !== 'Enter') return;
            event.preventDefault();
            pickTyped();
          }}
        />
      </label>
    </fieldset>
  );
}

function ColorPicker({ value, onChange }: { value: SpaceColor; onChange: (color: SpaceColor) => void }) {
  const t = useMessages();
  const name = useId();
  return (
    <fieldset className="field">
      <legend className="field-label">{t('spaceColorField')}</legend>
      <div className="choices">
        {SPACE_COLORS.map((color) => (
          <label key={color} className="choice" title={t(COLOR_NAMES[color])} style={spaceColorStyle(color)}>
            <input type="radio" name={name} checked={value === color} onChange={() => onChange(color)} />
            <span className="choice-face swatch" aria-hidden="true" />
            <span className="visually-hidden">{t(COLOR_NAMES[color])}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
