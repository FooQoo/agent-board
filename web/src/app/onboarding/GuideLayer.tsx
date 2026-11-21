// The first-run guide on the board: it picks the screen the controller is on, measures the lane
// the guide is pointing at, and draws the two sample cards in the spotlight over it. The sample
// cards are local: the board's own cards stay dimmed beneath and are never changed. The view parts
// stay free of the board, so this file joins them.

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '../../shared/api/contracts';
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
import { AskAiDialog } from '../../features/messages/ask/AskAiDialog';
import { EpicLabel } from '../../features/epics/label/EpicLabel';
import type { EpicRef } from '../../shared/api/contracts';
import { focusColumn, sampleRequest } from './guideSamples';
import type { GuidePhase } from './guideTiming';
import { phoneItemOf, usePhoneLaneRect } from './phoneTarget';
import { SampleAnswer } from './SampleAnswer';
import { useGuide } from './useGuide';

type Column = 'backlog' | 'todo' | 'doing' | 'done';

const noop = () => {};

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
    // The board can mount after the guide opens, and the lane then appears without the page changing size.
    // Look again on the next frames until the lane is there.
    let frame = 0;
    let tries = 0;
    const waitForLane = () => {
      if (
        !column ||
        document.querySelector(`section.lane[data-column="${column}"]`) ||
        tries >= 120
      )
        return;
      tries += 1;
      frame = requestAnimationFrame(() => {
        measure();
        waitForLane();
      });
    };
    waitForLane();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, column]);
  return rect;
}

const PANEL_INDEX: Record<GuidePhase, number> = {
  request: 1,
  planned: 2,
  question: 3,
  started: 4,
  done: 5,
};

/** The steps the panel counts. */
const STEP_TOTAL = 5;

/** The epic's label on a sample card: it looks like the board's and opens nothing. */
function renderSampleEpic(epic: EpicRef) {
  return <EpicLabel epic={epic} className="card__epic" stopPropagation onClick={noop} />;
}

/** What the guide needs to draw itself on the phone screen, which replaces the PC board below 768px. */
export interface PhoneGuide {
  link: PhoneGuideLink;
  projectName: string;
}

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
  // The request box is open: it too has the screen. It opens by itself when its step starts.
  const [asking, setAsking] = useState(false);
  const stepShown = screen.kind === 'step';
  useEffect(() => {
    setAsking(stepShown && phase === 'request');
  }, [stepShown, phase]);
  // The spotlight is on the lane the step is about; the request step frames no lane.
  const stepColumn: Column | null = stepShown ? focusColumn(phase) : null;
  const inLane = samples.filter((card) => card.taskStatus === stepColumn);
  const laneRect = useLaneRect(phone ? null : stepColumn);
  const phoneRect = usePhoneLaneRect(phone ? stepColumn : null);
  const rect = answering || asking ? null : phone ? phoneRect : laneRect;
  const cards = inLane.map((card) =>
    phone && projectId ? (
      <MonitorTask
        key={card.id}
        item={phoneItemOf(card, projectId, phone.projectName)}
        section={card.taskStatus}
        onOpenAnswer={() => setAnswering(true)}
      />
    ) : (
      <TaskCard
        key={card.id}
        task={card}
        selected={false}
        onSelect={noop}
        projectId={projectId ?? undefined}
        renderEpic={renderSampleEpic}
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
  const holding = phase === 'started' && !ready;
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
            total={STEP_TOTAL}
            title={t(copy.title)}
            body={t(copy.body)}
            hint={t(hintKey(phase))}
            waitingBadge={waiting ? t('onboarding.guide.waitingBadge') : undefined}
            actionLabel={t(
              phase === 'request' ? 'onboarding.guide.write' : 'onboarding.guide.next',
            )}
            actionDisabled={holding}
            onAction={phase === 'request' ? () => setAsking(true) : guide.next}
            onExit={guide.exit}
            compact={phone !== null && (answering || asking)}
          />
        }
      />
      {asking && (
        <AskAiDialog
          kind={phone ? 'sheet' : 'dialog'}
          initialText={sampleRequest(locale)}
          onSubmit={async () => guide.sent()}
          onClose={() => setAsking(false)}
        />
      )}
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

function hintKey(phase: GuidePhase): string {
  if (phase === 'request') return 'onboarding.guide.requestHint';
  if (phase === 'question') return 'onboarding.guide.waitingHint';
  return 'onboarding.guide.readFirst';
}

function panelCopy(phase: GuidePhase): { title: string; body: string } {
  return { title: `onboarding.steps.${phase}.title`, body: `onboarding.steps.${phase}.body` };
}
