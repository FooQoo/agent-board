import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleHelpIcon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { type BandQuestion, plainTitle } from './model/qa';
import './question-band.css';

export interface QuestionBandProps {
  /** The open questions of the project, oldest first. */
  questions: readonly BandQuestion[];
  /** The questions with an answer held on this screen. */
  held: ReadonlySet<string>;
  /** How many held answers can be sent; the header says so instead of the hint. */
  sendableCount: number;
  /** `board`: the PC band above the lanes. `phone`: the monitor's band under its counts. */
  variant: 'board' | 'phone';
  /** A question was chosen: the answer opens at it. */
  onOpen: (questionId: string) => void;
  /** Starts answering at the first question, or at the first one without an answer when some are held. */
  onAnswer: () => void;
  /** Opens the review of the held answers. */
  onReview: () => void;
}

/** The cards a question belongs to, as `#14 #15`, or the no-task label. */
export function taskRefs(referencedBy: readonly number[], noTask: string): string {
  return referencedBy.length === 0 ? noTask : referencedBy.map((id) => `#${id}`).join(' ');
}

/**
 * The band of unanswered questions, the same on the PC board and on a phone. It is never left out: with
 * no questions its header still shows the title and a count of 0. The header is a toggle that opens and
 * closes the list of questions; the band starts closed on every load and does not remember the choice,
 * and with no questions there is nothing to open. The count and the answer buttons stay in the header
 * while it is closed; the scroll buttons of the board band show only while it is open. Every item has
 * the same size; a long title stops at two lines.
 */
export function QuestionBand({
  questions,
  held,
  sendableCount,
  variant,
  onOpen,
  onAnswer,
  onReview,
}: QuestionBandProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ back: false, on: false });
  const empty = questions.length === 0;
  const holding = held.size > 0;

  const measure = useCallback(() => {
    const node = list.current;
    if (!node) return;
    const back = node.scrollLeft > 1;
    const on = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    setEdges((current) => (current.back === back && current.on === on ? current : { back, on }));
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is drawn again when the questions change, so it is measured again.
  useEffect(() => {
    measure();
    const node = list.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, questions.length, open]);
  const scroll = (direction: 1 | -1) => {
    const node = list.current;
    node?.scrollBy?.({ left: direction * node.clientWidth * 0.8, behavior: 'smooth' });
  };

  const Icon = empty ? CircleCheckIcon : CircleHelpIcon;
  const note = holding
    ? t('questions.band.held', { count: sendableCount })
    : t('questions.band.hint');
  return (
    <section
      className="question-band"
      data-variant={variant}
      data-state={empty ? 'empty' : holding ? 'held' : 'open'}
      aria-label={t('questions.band.title')}
    >
      <header className="question-band__header">
        <h2 className="question-band__heading">
          <button
            type="button"
            className="question-band__toggle"
            aria-expanded={open && !empty}
            aria-controls={empty ? undefined : listId}
            aria-label={t(open ? 'questions.band.hide' : 'questions.band.show', {
              count: questions.length,
            })}
            disabled={empty}
            onClick={() => setOpen((current) => !current)}
          >
            <Icon className="question-band__icon" aria-hidden="true" />
            <span className="question-band__title">{t('questions.band.title')}</span>
            <span className="question-band__count">{questions.length}</span>
            <ChevronDownIcon className="question-band__chevron" aria-hidden="true" />
          </button>
        </h2>
        {variant === 'board' && !empty && <p className="question-band__note">{note}</p>}
        {!empty && (
          <div className="question-band__actions">
            {variant === 'board' && open && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="s"
                  iconOnly
                  aria-label={t('questions.band.scrollBack')}
                  disabled={!edges.back}
                  onClick={() => scroll(-1)}
                >
                  <ChevronLeftIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="s"
                  iconOnly
                  aria-label={t('questions.band.scrollOn')}
                  disabled={!edges.on}
                  onClick={() => scroll(1)}
                >
                  <ChevronRightIcon aria-hidden="true" />
                </Button>
              </>
            )}
            {holding && variant === 'board' && (
              <Button type="button" variant="outline" size="s" onClick={onAnswer}>
                {t('questions.band.resume')}
              </Button>
            )}
            {holding ? (
              <Button type="button" size="s" onClick={onReview}>
                {t('questions.band.review')}
              </Button>
            ) : (
              <Button type="button" size="s" onClick={onAnswer}>
                {t('questions.band.answerAll')}
              </Button>
            )}
          </div>
        )}
      </header>
      {!empty && (
        <ul
          className="question-band__list"
          ref={list}
          id={listId}
          hidden={!open}
          aria-label={t('questions.band.list')}
          onScroll={measure}
        >
          {questions.map((question) => {
            const answered = held.has(question.id);
            return (
              <li key={question.id} className="question-band__entry">
                <button
                  type="button"
                  className="question-band__item"
                  data-question-id={question.id}
                  data-held={answered ? 'true' : undefined}
                  aria-label={t(answered ? 'questions.band.itemHeld' : 'questions.band.item', {
                    title: plainTitle(question.title),
                    tasks: taskRefs(question.referencedBy, t('questions.band.noTask')),
                  })}
                  onClick={() => onOpen(question.id)}
                >
                  <span className="question-band__meta">
                    <span className="question-band__tasks">
                      {taskRefs(question.referencedBy, t('questions.band.noTask'))}
                    </span>
                    {answered && (
                      <span className="question-band__held">
                        <CircleCheckIcon aria-hidden="true" />
                        {t('questions.band.heldMark')}
                      </span>
                    )}
                  </span>
                  <span className="question-band__text">{plainTitle(question.title)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
