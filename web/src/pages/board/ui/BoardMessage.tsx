import { CircleAlertIcon, FolderIcon, FolderXIcon, LoaderCircleIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';

export type BoardMessageKind =
  | 'empty'
  | 'loading'
  | 'error'
  | 'switching'
  | 'boardError'
  | 'noProjects'
  | 'notFound';

export interface BoardMessageProps {
  kind: BoardMessageKind;
  onRetry?: () => void;
}

export function BoardMessage({ kind, onRetry }: BoardMessageProps) {
  const { t } = useTranslation();
  if (kind === 'loading') {
    return (
      <div className="board-message board-message--loading" role="status">
        <p className="board-message__title">{t('board.loading')}</p>
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div className="board-message board-message--error" role="alert">
        <p className="board-message__title">{t('board.loadError')}</p>
        <Button type="button" onClick={onRetry}>
          {t('board.retry')}
        </Button>
      </div>
    );
  }
  if (kind === 'switching') {
    return (
      <div className="board-message board-message--state board-message--switching" role="status">
        <LoaderCircleIcon aria-hidden="true" className="board-message__icon" />
        <p className="board-message__title">{t('board.loadingBoard')}</p>
      </div>
    );
  }
  if (kind === 'boardError') {
    return (
      <div className="board-message board-message--state board-message--error" role="alert">
        <CircleAlertIcon aria-hidden="true" className="board-message__icon" />
        <p className="board-message__title">{t('board.boardLoadError')}</p>
        <p className="board-message__sub">{t('board.boardLoadErrorHint')}</p>
        <Button type="button" className="board-message__retry" onClick={onRetry}>
          {t('board.retry')}
        </Button>
      </div>
    );
  }
  if (kind === 'noProjects') {
    return (
      <div className="board-message board-message--state board-message--no-projects" role="status">
        <FolderIcon aria-hidden="true" className="board-message__icon" />
        <p className="board-message__title">{t('board.noProjects')}</p>
        <p className="board-message__sub">{t('board.noProjectsHint')}</p>
        <code className="board-message__command">agboard project create NAME</code>
      </div>
    );
  }
  if (kind === 'notFound') {
    return (
      <div className="board-message board-message--state board-message--not-found" role="status">
        <FolderXIcon aria-hidden="true" className="board-message__icon" />
        <p className="board-message__title">{t('board.projectNotFound')}</p>
        <p className="board-message__sub">{t('board.projectNotFoundHint')}</p>
      </div>
    );
  }
  return (
    <div className="board-message board-message--empty" role="status">
      <p className="board-message__title">{t('board.empty')}</p>
      <p className="board-message__sub">{t('board.emptyHint')}</p>
    </div>
  );
}
