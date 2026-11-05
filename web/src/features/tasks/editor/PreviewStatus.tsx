import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorStatus, type EditorStatusLine } from '../../../shared/ui/editor/EditorStatus';
import { StateChip } from '../../../shared/ui/editor/StateChip';
import type { PreviewProblem } from '../../../shared/ui/editor/usePreviewLock';

export type ReadOnlyReason = 'running' | 'archived';

export interface PreviewStatusInput {
  readOnlyReason?: ReadOnlyReason;
  problem: PreviewProblem;
  /** The editor differs from what it showed. */
  dirty: boolean;
  /** The modal holds the draft lock: it entered one, or the card was a draft when it opened. */
  locked: boolean;
  /** When the screen last followed a change. */
  updatedAt: Date | null;
}

/** The chip next to the title and the footer line of the task preview, for the state it is in. */
export function usePreviewStatus({
  readOnlyReason,
  problem,
  dirty,
  locked,
  updatedAt,
}: PreviewStatusInput): { badge: ReactNode; status: ReactNode } {
  const { t, i18n } = useTranslation();
  const running = readOnlyReason === 'running' || problem === 'running';
  const badge = running ? <StateChip kind="running" /> : locked ? <StateChip kind="draft" /> : '';

  const lines: EditorStatusLine[] = [];
  if (readOnlyReason === 'running')
    lines.push({ tone: 'reason', text: t('editor.readOnlyRunning') });
  else if (readOnlyReason === 'archived')
    lines.push({ tone: 'reason', text: t('editor.readOnlyArchived') });
  else if (problem === 'running') {
    lines.push({ tone: 'error', text: t('editor.cannotSaveRunning') });
    lines.push({ tone: 'info', text: t('editor.unsaved') });
  } else if (problem === 'conflict') {
    lines.push({ tone: 'error', text: t('editor.conflictTask') });
    lines.push({ tone: 'lock', text: t('editor.lockedTask') });
  } else if (dirty && locked) lines.push({ tone: 'lock', text: t('editor.lockedTask') });
  else if (dirty) lines.push({ tone: 'info', text: t('editor.unsaved') });

  if (lines.length > 0) return { badge, status: <EditorStatus lines={lines} /> };
  const time = updatedAt?.toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    badge,
    status: time === undefined ? t('editor.noChanges') : t('editor.updatedAt', { time }),
  };
}
