// The first-run guide on the board: it picks the screen the controller is on, measures
// the lane the guide is pointing at, and shows the real task cards and answer form in
// the spotlight. The view parts stay free of the board, so this file joins them.

import { useCallback, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId, Task } from '../../shared/api/contracts';
import type { TaskAnswerController } from '../../features/tasks/answer/model/useTaskAnswers';
import { TaskCard } from '../../features/tasks/card/TaskCard';
import { OnboardingComplete } from '../../features/onboarding/ui/OnboardingComplete';
import { OnboardingGuidePanel } from '../../features/onboarding/ui/OnboardingGuidePanel';
import { OnboardingNotice } from '../../features/onboarding/ui/OnboardingNotice';
import { OnboardingStage } from '../../features/onboarding/ui/OnboardingStage';
import { OnboardingWelcome } from '../../features/onboarding/ui/OnboardingWelcome';
import type { SpotlightRect } from '../../shared/ui/spotlight/Spotlight';
import '../../shared/i18n/onboarding-strings';
import { newId } from './api';
import type { GuidePhase } from './api';
import { useGuide } from './useGuide';

type Column = 'todo' | 'doing' | 'done';

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
  complete: 4,
};

export function GuideLayer({
  projectId,
  eligible,
  tasks,
  answers,
  syncedAt,
  onAnswerChanged,
}: {
  projectId: ProjectId | null;
  eligible: boolean;
  tasks: Task[];
  answers: TaskAnswerController;
  syncedAt: Date | null;
  onAnswerChanged: () => void;
}) {
  const { t } = useTranslation();
  const [clientId] = useState(newId);
  const guide = useGuide({ projectId, eligible, tasks, clientId });
  const { screen, state, busy, error, ready } = guide;
  const run = state?.run ?? null;
  const samples = run
    ? tasks
        .filter((task) => task.onboardingSample?.runId === run.runId)
        .sort((a, b) => (a.onboardingSample?.ordinal ?? 0) - (b.onboardingSample?.ordinal ?? 0))
    : [];
  // The spotlight is on the lane of the card the step is about: the first card, then the second.
  const focusOrdinal =
    run && ['question', 'second-running', 'second-done', 'complete'].includes(run.phase) ? 2 : 1;
  const focus = samples.find((task) => task.onboardingSample?.ordinal === focusOrdinal) ?? null;
  const column: Column | null = focus ? (focus.taskStatus as Column) : null;
  const rect = useLaneRect(screen.kind === 'step' ? column : null);
  const inLane = samples.filter((task) => task.taskStatus === column);
  const cards = inLane.map((task) => (
    <TaskCard
      key={task.id}
      task={task}
      selected={false}
      onSelect={noop}
      projectId={projectId ?? undefined}
      answers={answers}
      syncedAt={syncedAt}
      onAnswerChanged={onAnswerChanged}
    />
  ));

  if (screen.kind === 'hidden') return null;

  if (screen.kind === 'welcome') {
    return (
      <OnboardingWelcome busy={busy} error={error} onStart={guide.start} onSkip={guide.skip} />
    );
  }

  if (screen.kind === 'complete') {
    return <OnboardingComplete busy={busy} error={error} onFinish={guide.finish} />;
  }

  if (screen.kind === 'notice') {
    return <OnboardingNotice message={t('onboarding.archived')} />;
  }

  const phase: GuidePhase = run?.phase ?? 'samples';
  const index = PANEL_INDEX[phase];
  const copy = panelCopy(phase);
  // A failed step offers Retry in place of its action. A question waits on the card instead.
  const failed = error !== null;
  const waiting = phase === 'question' && !failed;
  const holding = (phase === 'first-running' || phase === 'second-running') && !ready;
  return (
    <OnboardingStage
      target={rect}
      onExit={guide.exit}
      renderTarget={
        cards.length > 0 ? <div className="onboarding-stage__cards">{cards}</div> : null
      }
      guide={
        <OnboardingGuidePanel
          index={index}
          total={4}
          title={t(copy.title)}
          body={t(copy.body)}
          hint={t(waiting ? 'onboarding.guide.waitingHint' : 'onboarding.guide.readFirst')}
          waitingBadge={waiting ? t('onboarding.guide.waitingBadge') : undefined}
          actionLabel={t(actionKey(phase, failed))}
          actionDisabled={holding}
          busy={busy}
          error={error}
          onAction={failed ? guide.retry : guide.next}
          onExit={guide.exit}
        />
      }
    />
  );
}

function actionKey(phase: GuidePhase, failed: boolean): string {
  if (failed) return 'onboarding.guide.retry';
  return phase === 'samples' ? 'onboarding.guide.watch' : 'onboarding.guide.next';
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
    case 'complete':
      return { title: 'onboarding.steps.resumed.title', body: 'onboarding.steps.resumed.body' };
    default:
      return { title: 'onboarding.steps.samples.title', body: 'onboarding.steps.samples.body' };
  }
}
