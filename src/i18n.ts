import type { I18nPort } from './browser/port';
import type messages from '../public/_locales/en/messages.json';

/** The name of a message in `public/_locales/en/messages.json`. */
export type MessageKey = keyof typeof messages;

/** Every user-facing string goes through here, so the community can translate it. */
export function getMessage(i18n: I18nPort, key: MessageKey, substitutions?: string | string[]): string {
  return i18n.getMessage(key, substitutions);
}

/** Gives an extension page its title, language and text direction in the user's locale. */
export function localizeDocument(i18n: I18nPort, document: Document): void {
  document.title = getMessage(i18n, 'extName');
  document.documentElement.lang = i18n.getMessage('@@ui_locale').replace('_', '-');
  document.documentElement.dir = i18n.getMessage('@@bidi_dir');
}
