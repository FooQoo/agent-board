import { preloadable } from '../../shared/lib/lazy/preloadable';
import { preloadDocumentBlocks } from '../../features/tasks/detail/BodyDocumentView';
import { preloadDecisionQuestion } from '../../features/tasks/answer/DecisionQuestion';
import { preloadDetailSection } from '../../features/tasks/detail/DetailSection';

/**
 * The board's card, epic and bulk-archive dialogs, with the editor shell, attachments and condition
 * editor they use, load after the board is shown (see `preloadable`).
 */
export const actionDialog = preloadable(() =>
  import('./ActionDialog').then((module) => module.ActionDialog),
);
export const bulkArchiveDialog = preloadable(() =>
  import('../../features/tasks/archive/BulkArchiveDialog').then(
    (module) => module.BulkArchiveDialog,
  ),
);

/** The answer dialog, with the Markdown renderer of the question, loads before it is first opened. */
export const decisionAnswerDialog = preloadable(() =>
  import('../../features/tasks/answer/DecisionAnswerDialogContainer').then(
    (module) => module.DecisionAnswerDialogContainer,
  ),
);

/** The docs dialog loads when it is first opened. */
export const docsDialog = preloadable(() =>
  import('../../features/docs/ui/DocsDialogContainer').then((module) => module.DocsDialogContainer),
);

/**
 * Fetches the dialogs and the Markdown renderer once the board is shown; a failed fetch is tried
 * again when one of them is first rendered.
 */
export function preloadBoardCode(): void {
  for (const preload of [
    actionDialog.preload,
    bulkArchiveDialog.preload,
    decisionAnswerDialog.preload,
    preloadDecisionQuestion,
    preloadDocumentBlocks,
    preloadDetailSection,
  ])
    preload().catch(() => {});
}
