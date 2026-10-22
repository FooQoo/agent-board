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
import { newId } from './api';
import type { GuidePhase } from './api';
import { useGuide } from './useGuide';

type Column = 'todo' | 'doing' | 'done';

const noop = () => {};

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
    setRect({
      x: box.left + 6,
      y: box.top + 46,
      width: box.width - 12,
      height: Math.min(box.height - 52, 500),
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
  'first-running': 1,
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
  const { screen, state, busy, error } = guide;
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
  const onAction = phase === 'question' ? noop : guide.next;
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
          hint={t(
            phase === 'question' ? 'onboarding.guide.waitingHint' : 'onboarding.guide.readFirst',
          )}
          waitingBadge={phase === 'question' ? t('onboarding.guide.waitingBadge') : undefined}
          actionLabel={t(phase === 'samples' ? 'onboarding.guide.watch' : 'onboarding.guide.next')}
          busy={busy}
          error={error}
          onAction={onAction}
          onExit={guide.exit}
        />
      }
    />
  );
}

function panelCopy(phase: GuidePhase): { title: string; body: string } {
  switch (phase) {
    case 'first-done':
      return { title: 'onboarding.steps.running.title', body: 'onboarding.steps.running.body' };
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
