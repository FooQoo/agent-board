import { preloadable } from '../lib/preloadable';
import { preloadMarkdownSections } from './markdown/LazyMarkdownSections';

/**
 * The board's card, epic and bulk-archive dialogs, with the editor shell, attachments and condition
 * editor they use, load after the board is shown (see `preloadable`).
 */
export const actionDialog = preloadable(() =>
  import('./ActionDialog').then((module) => module.ActionDialog),
);
export const bulkArchiveDialog = preloadable(() =>
  import('./archive/BulkArchiveDialog').then((module) => module.BulkArchiveDialog),
);

/**
 * Fetches the dialogs and the Markdown renderer once the board is shown; a failed fetch is tried
 * again when one of them is first rendered.
 */
export function preloadBoardCode(): void {
  for (const preload of [actionDialog.preload, bulkArchiveDialog.preload, preloadMarkdownSections])
    preload().catch(() => {});
}
