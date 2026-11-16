// The first-run guide on the board: it picks the screen the controller is on, measures the lane
// the guide is pointing at, and draws the two sample cards in the spotlight over it. The sample
// cards are local: the board's own cards stay dimmed beneath and are never changed. The view parts
// stay free of the board, so this file joins them.

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '../../shared/api/contracts';
import { AnswerBook } from '../../features/tasks/answer/model/answerBook';
import { TaskCard } from '../../features/tasks/card/TaskCard';
import type { PhoneGuideLink } from '../../features/onboarding/model/phoneGuideLink';
import { MonitorTask } from '../../pages/monitor/components/MonitorTask';
import '../../pages/monitor/monitor-screen.css';
import { OnboardingComplete } from '../../features/onboarding/ui/OnboardingComplete';
import { OnboardingGuidePanel } from '../../features/onboarding/ui/OnboardingGuidePanel';
import { OnboardingStage } from '../../features/onboarding/ui/OnboardingStage';
import { OnboardingWelcome } from '../../features/onboarding/ui/OnboardingWelcome';
import type { SpotlightRect } from '../../shared/ui/spotlight/Spotlight';
import '../../shared/i18n/onboarding-strings';
import { focusOrdinal } from './guideSamples';
import type { GuidePhase } from './guideTiming';
import { phoneItemOf, usePhoneLaneRect } from './phoneTarget';
import { SampleAnswer } from './SampleAnswer';
import { useGuide } from './useGuide';

type Column = 'todo' | 'doing' | 'done';

/** The gap between the frame and the guide panel, in pixels. */
const PANEL_GAP = 24;
/** Where the guide panel sits from the bottom of the stage, as in onboarding.css. */
const PANEL_SPACE = 250;

/** The lane's frame in viewport pixels, measured from the board's own element. */
function useLaneRect(column: Column | null): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const measure = useCallback(() => {
    if (!column) {
      setRect(null);
      return;
    }
    const lane = document.querySelector<HTMLElement>(`section.lane[data-column="${column}"]`);
    if (!lane) {
      setRect(null);
      return;
    }
    const box = lane.getBoundingClientRect();
    // The frame keeps the mock's inset: 6px at the sides, and below the lane's header.
    const top = box.top + 46;
    // The frame ends above the guide panel, so the panel never covers the card or the answer form.
    const panel = document.querySelector<HTMLElement>('.onboarding-panel');
    const panelTop = panel ? panel.getBoundingClientRect().top : window.innerHeight - PANEL_SPACE;
    setRect({
      x: box.left + 6,
      y: top,
      width: box.width - 12,
      // The frame follows its cards. It is capped here, and taller cards scroll inside it.
      maxHeight: Math.max(0, Math.min(box.height - 52, panelTop - PANEL_GAP - top)),
    });
  }, [column]);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);
  return rect;
}

const PANEL_INDEX: Record<GuidePhase, number> = {
  samples: 1,
  'first-running': 2,
  'first-done': 2,
  question: 3,
  'second-running': 4,
  'second-done': 4,
};

/** What the guide needs to draw itself on the phone screen, which replaces the PC board below 768px. */
export interface PhoneGuide {
  link: PhoneGuideLink;
  projectName: string;
}

const noop = () => {};

export function GuideLayer({
  projectId,
  eligible,
  phone = null,
}: {
  /** Set while the phone screen is shown; `null` on the PC board. One guide serves both. */
  phone?: PhoneGuide | null;
  projectId: ProjectId | null;
  eligible: boolean;
}) {
  const { t } = useTranslation();
  const guide = useGuide({ projectId, eligible });
  const { screen, phase, samples, locale, ready } = guide;
  // The sample question's form is open: it has the screen, so the stage frames nothing.
  const [answering, setAnswering] = useState(false);
  useEffect(() => {
    if (phase !== 'question') setAnswering(false);
  }, [phase]);
  // The spotlight is on the lane of the card the step is about: the first card, then the second.
  const focus = samples[focusOrdinal(phase) - 1];
  const stepColumn: Column | null = screen.kind === 'step' && focus ? focus.taskStatus : null;
  const inLane = samples.filter((card) => card.taskStatus === stepColumn);
  const laneRect = useLaneRect(phone ? null : stepColumn);
  const phoneRect = usePhoneLaneRect(phone ? stepColumn : null);
  const rect = answering ? null : phone ? phoneRect : laneRect;
  // The sample cards have no answers held, and nothing to read or send.
  const book = useMemo(() => new AnswerBook(), []);
  const cards = inLane.map((card) =>
    phone && projectId ? (
      <MonitorTask
        key={card.id}
        item={phoneItemOf(card, projectId, phone.projectName)}
        section={card.taskStatus}
        onOpenAnswer={() => setAnswering(true)}
        answerController={{
          book,
          read: () => Promise.reject(new Error('The guide has no server question.')),
          write: () => Promise.resolve(),
        }}
      />
    ) : (
      <TaskCard
        key={card.id}
        task={card}
        selected={false}
        onSelect={noop}
        projectId={projectId ?? undefined}
        answers={book}
        onAnswer={() => setAnswering(true)}
      />
    ),
  );

  // On the phone one lane is on screen at a time: the step's lane is brought there.
  const phoneLink = phone?.link ?? null;
  useEffect(() => {
    if (!phoneLink || !stepColumn) return undefined;
    phoneLink.setLane(stepColumn);
    return () => phoneLink.setLane(null);
  }, [phoneLink, stepColumn]);

  if (screen.kind === 'hidden') return null;

  if (screen.kind === 'welcome') {
    return <OnboardingWelcome onStart={guide.start} onSkip={guide.skip} />;
  }

  if (screen.kind === 'complete') {
    return <OnboardingComplete onFinish={guide.finish} />;
  }

  const index = PANEL_INDEX[phase];
  const copy = panelCopy(phase);
  // A question waits on the card instead of offering the step's action.
  const waiting = phase === 'question';
  const holding = (phase === 'first-running' || phase === 'second-running') && !ready;
  return (
    <>
      <OnboardingStage
        target={rect}
        onExit={guide.exit}
        renderTarget={
          cards.length > 0 ? (
            <div
              className={
                phone
                  ? 'onboarding-stage__cards onboarding-stage__cards--phone'
                  : 'onboarding-stage__cards'
              }
            >
              {cards}
            </div>
          ) : null
        }
        guide={
          <OnboardingGuidePanel
            index={index}
            total={4}
            title={t(copy.title)}
            body={t(copy.body)}
            hint={t(waiting ? 'onboarding.guide.waitingHint' : 'onboarding.guide.readFirst')}
            waitingBadge={waiting ? t('onboarding.guide.waitingBadge') : undefined}
            actionLabel={t(
              phase === 'samples' ? 'onboarding.guide.watch' : 'onboarding.guide.next',
            )}
            actionDisabled={holding}
            onAction={guide.next}
            onExit={guide.exit}
            compact={phone !== null && answering}
          />
        }
      />
      {answering && (
        <SampleAnswer
          phone={phone !== null}
          locale={locale}
          onSend={() => {
            setAnswering(false);
            guide.answered();
          }}
          onClose={() => setAnswering(false)}
        />
      )}
    </>
  );
}

function panelCopy(phase: GuidePhase): { title: string; body: string } {
  switch (phase) {
    case 'first-running':
      return { title: 'onboarding.steps.running.title', body: 'onboarding.steps.running.body' };
    case 'first-done':
      return { title: 'onboarding.steps.done.title', body: 'onboarding.steps.done.body' };
    case 'question':
      return { title: 'onboarding.steps.pending.title', body: 'onboarding.steps.pending.body' };
    case 'second-running':
    case 'second-done':
      return { title: 'onboarding.steps.resumed.title', body: 'onboarding.steps.resumed.body' };
    default:
      return { title: 'onboarding.steps.samples.title', body: 'onboarding.steps.samples.body' };
  }
}
