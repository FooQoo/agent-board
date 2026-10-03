import { useTranslation } from 'react-i18next';

export interface BoardMessageProps {
  kind: 'empty' | 'loading' | 'error';
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
        <button type="button" className="button button--primary" onClick={onRetry}>
          {t('board.retry')}
        </button>
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
