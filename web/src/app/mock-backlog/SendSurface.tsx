import { AlertTriangleIcon, ArrowRightIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { countIn, type MockCard } from './data';
import { Surface } from './Surface';
import { useMockText } from './text';
import './backlog-mock.css';

/**
 * The confirmation of "Send to Todo": the cards that go, the lane counts before and after, and, when
 * a card still has an open question, a warning that names it and needs an explicit confirmation.
 */
export function SendSurface({
  kind,
  cards,
  ids,
  onClose,
  onConfirm,
}: {
  kind: 'dialog' | 'sheet';
  cards: readonly MockCard[];
  ids: readonly number[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const m = useMockText();
  const [ack, setAck] = useState(false);
  const ackId = useId();
  const picked = cards.filter((card) => ids.includes(card.id));
  const withQuestion = picked.filter((card) => card.question !== null);
  const needAck = withQuestion.length > 0;
  const b0 = countIn(cards, 'backlog');
  const t0 = countIn(cards, 'todo');
  return (
    <Surface
      kind={kind}
      title={m.sendTitle}
      onClose={onClose}
      className="bsend"
      footer={
        <>
          {needAck && !ack && <p className="bsend__need">{m.sendNeedAck}</p>}
          <DialogActions>
            <Button type="button" variant="outline" onClick={onClose}>
              {m.cancel}
            </Button>
            <Button type="button" disabled={needAck && !ack} onClick={onConfirm}>
              {m.sendConfirm}
            </Button>
          </DialogActions>
        </>
      }
    >
      <div className="bsend__body">
        <p className="bsend__scope">{m.sendScope(picked.length)}</p>
        <div className="bsend__counts" role="group" aria-label={`${m.sendBefore} / ${m.sendAfter}`}>
          <div className="bsend__count">
            <span className="bsend__count-head">{m.sendBefore}</span>
            <span>
              {m.backlog} <strong>{m.laneCount(b0)}</strong>
            </span>
            <span>
              {m.todo} <strong>{m.laneCount(t0)}</strong>
            </span>
          </div>
          <ArrowRightIcon aria-hidden="true" className="bsend__arrow" />
          <div className="bsend__count" data-after="true">
            <span className="bsend__count-head">{m.sendAfter}</span>
            <span>
              {m.backlog} <strong>{m.laneCount(b0 - picked.length)}</strong>
            </span>
            <span>
              {m.todo} <strong>{m.laneCount(t0 + picked.length)}</strong>
            </span>
          </div>
        </div>
        <section>
          <h3 className="bsend__h">{m.sendTargets}</h3>
          <ul className="bsend__list">
            {picked.map((card) => (
              <li key={card.id} className="bsend__item">
                <span className="bsend__id">#{card.id}</span>
                <span className="bsend__title">{card.title}</span>
                {card.question && <span className="bsend__q">{m.openQuestion}</span>}
              </li>
            ))}
          </ul>
        </section>
        {needAck && (
          <div className="bwarn" role="alert">
            <AlertTriangleIcon aria-hidden="true" />
            <div>
              <strong>{m.warnQuestionTitle}</strong>
              <p>{withQuestion.map((card) => `#${card.id} ${card.question}`).join(' / ')}</p>
              <p>{m.warnQuestionBody}</p>
              <div className="bwarn__ack">
                <Checkbox
                  id={ackId}
                  checked={ack}
                  onCheckedChange={(value) => setAck(value === true)}
                />
                <label htmlFor={ackId}>{m.warnQuestionAck}</label>
              </div>
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}
