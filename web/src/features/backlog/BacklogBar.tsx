import { SendIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import '../../shared/styles/backlog.css';

/**
 * The bar of the selection mode: how many cards are picked, "Cancel" and "Send to Todo (N)" in two
 * buttons of the same width. It sits at the bottom of the Backlog lane on the PC and of the screen
 * on the phone; it is also the way to send by keyboard or screen reader, where dragging is not.
 */
export function BacklogBar({
  count,
  busy,
  onCancel,
  onSend,
  variant,
}: {
  count: number;
  busy?: boolean;
  onCancel: () => void;
  onSend: () => void;
  variant: 'lane' | 'phone';
}) {
  const { t } = useTranslation();
  return (
    <section className="backlog-bar" data-variant={variant} aria-label={t('backlog.barLabel')}>
      <span className="backlog-bar__count" role="status">
        {t('backlog.selected', { count })}
      </span>
      <div className="backlog-bar__actions">
        <Button type="button" size="s" variant="outline" disabled={busy} onClick={onCancel}>
          {t('backlog.cancel')}
        </Button>
        <Button type="button" size="s" disabled={busy || count === 0} onClick={onSend}>
          <SendIcon aria-hidden="true" />
          {t('backlog.send', { count })}
        </Button>
      </div>
    </section>
  );
}
