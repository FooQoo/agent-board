import { AlertTriangleIcon, ArrowRightIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { allAchieved, countIn, type Fixture, type MockCard } from './data';
import { Surface } from './Surface';
import { useMockText } from './text';
import './backlog-mock.css';

export interface SendTarget {
  scope: 'cards' | 'epic' | 'one';
  epicId: string | null;
  ids: number[];
}

/** The warnings a send shows, derived from the cards (SPEC 3.3, 3.5 and chapter 5). */
export function warningsOf(cards: readonly MockCard[], target: SendTarget) {
  const picked = cards.filter((card) => target.ids.includes(card.id));
  const withQuestion = picked.filter((card) => card.question !== null);
  const achieved = picked.filter(allAchieved);
  const highestWave = Math.max(...picked.map((card) => card.wave));
  // A Backlog card of an earlier wave that is not part of this send keeps the later wave waiting.
  const blockers = cards.filter(
    (card) =>
      card.epicId !== null &&
      card.epicId === target.epicId &&
      card.lane === 'backlog' &&
      !target.ids.includes(card.id) &&
      card.wave < highestWave,
  );
  return { picked, withQuestion, achieved, blockers };
}

/**
 * The confirmation of "Send to Todo": what is sent, the lane counts before and after, and the warnings.
 * A card with an open question needs an explicit confirmation; nothing else blocks the send.
 */
export function SendSurface({
  kind,
  fixture,
  cards,
  target,
  onClose,
  onConfirm,
}: {
  kind: 'dialog' | 'sheet';
  fixture: Fixture;
  cards: readonly MockCard[];
  target: SendTarget;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const m = useMockText();
  const [ack, setAck] = useState(false);
  const ackId = useId();
  const { picked, withQuestion, achieved, blockers } = warningsOf(cards, target);
  const needAck = withQuestion.length > 0;
  const b0 = countIn(cards, 'backlog');
  const t0 = countIn(cards, 'todo');
  const scope =
    target.scope === 'epic'
      ? m.sendScopeEpic(target.epicId ?? '', picked.length)
      : target.scope === 'cards'
        ? m.sendScopeCards(picked.length)
        : m.sendScopeOne;
  const epicName = fixture.epics.find((item) => item.id === target.epicId)?.name;
  return (
    <Surface
      kind={kind}
      title={m.sendTitle}
      identity={target.epicId ? `${target.epicId} ${epicName ?? ''}` : m.standalone}
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
        <p className="bsend__scope">{scope}</p>
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
                <span className="bsend__wave">{m.waveLabel(card.wave)}</span>
              </li>
            ))}
          </ul>
        </section>
        {withQuestion.length > 0 && (
          <div className="bwarn" role="alert" data-tone="question">
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
        {blockers.length > 0 && (
          <div className="bwarn" role="note" data-tone="wave">
            <AlertTriangleIcon aria-hidden="true" />
            <div>
              <strong>{m.warnWaveTitle}</strong>
              <p>{m.warnWaveBody(blockers.map((card) => `#${card.id}`).join(', '))}</p>
            </div>
          </div>
        )}
        {achieved.length > 0 && (
          <div className="bwarn" role="note" data-tone="achieved">
            <AlertTriangleIcon aria-hidden="true" />
            <div>
              <strong>{m.warnAchievedTitle}</strong>
              <p>
                {achieved.map((card) => `#${card.id}`).join(', ')}: {m.warnAchievedBody}
              </p>
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}
