import { AlertTriangleIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { DialogActions } from '@/shared/ui/dialog-actions';
import type { TaskSummary } from '../../shared/api/contracts';
import type { BacklogTarget } from './send';
import { Surface } from '../../shared/ui/surface/Surface';
import '../../shared/styles/backlog.css';

/**
 * The confirmation before cards with an open question are sent: it names those cards and needs a
 * check before it sends. A dialog on the PC board, a bottom sheet on the phone.
 */
export function SendConfirm({
  kind,
  to = 'todo',
  count,
  warned,
  busy,
  onConfirm,
  onCancel,
}: {
  kind: 'dialog' | 'sheet';
  /** The lane the cards go to; the texts name it. */
  to?: BacklogTarget;
  count: number;
  warned: readonly TaskSummary[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [ack, setAck] = useState(false);
  const ackId = useId();
  const lane = t(`column.${to}`);
  const k = to === 'todo' ? 'backlog' : 'backlog.move';
  return (
    <Surface
      kind={kind}
      title={t(`${k}.confirmTitle`, { lane })}
      closeLabel={t('dialog.close')}
      onClose={() => !busy && onCancel()}
      dismissible={!busy}
      className="backlog-send"
      footer={
        <DialogActions>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {t('backlog.cancel')}
          </Button>
          <Button type="button" disabled={!ack || busy} onClick={onConfirm}>
            {busy
              ? t('backlog.sending')
              : t(to === 'todo' ? 'backlog.sendConfirm' : 'backlog.move.confirm', { lane })}
          </Button>
        </DialogActions>
      }
    >
      <p className="backlog-send__scope">{t(`${k}.confirmScope`, { count, lane })}</p>
      <div className="backlog-send__warn" role="alert">
        <AlertTriangleIcon aria-hidden="true" />
        <div>
          <strong>{t('backlog.warnTitle')}</strong>
          <ul className="backlog-send__list">
            {warned.map((task) => (
              <li key={task.id}>
                <span className="backlog-send__id">#{task.id}</span> {task.title}
              </li>
            ))}
          </ul>
          <p>{t(`${k}.warnBody`)}</p>
          <div className="backlog-send__ack">
            <Checkbox
              id={ackId}
              checked={ack}
              onCheckedChange={(value) => setAck(value === true)}
            />
            <label htmlFor={ackId}>{t('backlog.warnAck')}</label>
          </div>
        </div>
      </div>
    </Surface>
  );
}
