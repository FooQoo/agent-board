import { CircleDotDashedIcon, SendIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import '../../../shared/styles/backlog.css';

/**
 * Tells in a card's details that it is a plan in the Backlog, which no agent starts, and sends it
 * to Todo. The same operation as the selection mode: a warning about open questions is confirmed first.
 */
export function BacklogBanner({ busy, onSend }: { busy?: boolean; onSend?: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="backlog-detail" aria-label={t('backlog.detail.heading')}>
      <p className="backlog-detail__head">
        <CircleDotDashedIcon aria-hidden="true" size={15} />
        <span>{t('backlog.detail.heading')}</span>
      </p>
      <p className="backlog-detail__text">{t('backlog.detail.text')}</p>
      {onSend && (
        <Button type="button" size="s" className="detail-btn" disabled={busy} onClick={onSend}>
          <SendIcon aria-hidden="true" />
          {t('backlog.detail.send')}
        </Button>
      )}
    </section>
  );
}
