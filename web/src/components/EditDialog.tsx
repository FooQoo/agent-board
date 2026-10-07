import { useTranslation } from 'react-i18next';
import type { Card } from '../types';
import { DialogFrame } from './DialogFrame';

/** Placeholder until the real editor lands: it opens, says so, and only closes. */
export function EditDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <DialogFrame
      title={t('dialog.editTitle')}
      submitLabel={t('dialog.close')}
      cardId={card.id}
      onClose={onClose}
      validate={() => null}
      save={async () => undefined}
    >
      <p className="modal__card">
        #{card.id} {card.title}
      </p>
      <p className="modal__hint">{t('dialog.notImplemented')}</p>
    </DialogFrame>
  );
}
