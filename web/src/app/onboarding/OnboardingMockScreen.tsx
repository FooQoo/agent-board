import '../../shared/i18n/onboarding-strings';
import { useTranslation } from 'react-i18next';
import { DecisionAnswerButton } from '../../features/tasks/answer/DecisionAnswerButton';
import { TaskCardView } from '../../features/tasks/card/TaskCard';
import { EpicLabel } from '../../features/epics/label/EpicLabel';
import type { EpicRef, TaskSummary } from '../../shared/api/contracts';
import type { SpotlightRect } from '../../shared/ui/spotlight/Spotlight';
import { OnboardingComplete } from '../../features/onboarding/ui/OnboardingComplete';
import { OnboardingGuidePanel } from '../../features/onboarding/ui/OnboardingGuidePanel';
import { OnboardingStage } from '../../features/onboarding/ui/OnboardingStage';
import { OnboardingWelcome } from '../../features/onboarding/ui/OnboardingWelcome';
import '../../features/onboarding/ui/onboarding.css';
import { focusColumn, sampleCards } from './guideSamples';
import type { GuidePhase } from './guideTiming';
import { CARD_PITCH, MockBoard, MockStageCards } from './MockBoard';

export type ScreenKind = 'welcome' | GuidePhase | 'complete';

const noop = () => {};
const AT = new Date(2026, 9, 22, 8, 15).toISOString();

/** The frame of each lane; its height follows the cards it holds. */
const FRAME_X = { todo: 30, doing: 326, done: 622 } as const;

const renderEpic = (epic: EpicRef) => (
  <EpicLabel epic={epic} className="card__epic" stopPropagation onClick={noop} />
);

/** One sample card as the board draws it; a pending card carries the answer button. */
function sampleCard(task: TaskSummary) {
  return (
    <TaskCardView
      key={task.id}
      task={task}
      selected={false}
      showPendingReason={false}
      renderEpic={renderEpic}
      onSelect={noop}
    >
      {task.agentStatus === 'pending' && (
        <div className="card__answer">
          <DecisionAnswerButton taskId={task.id} onClick={noop} />
        </div>
      )}
    </TaskCardView>
  );
}

/** One screen of the mock, drawn from the same sample cards the guide uses. */
export function OnboardingMockScreen({ kind }: { kind: ScreenKind }) {
  const { t, i18n } = useTranslation();
  if (kind === 'welcome') {
    return (
      <>
        <MockBoard count={0} />
        <OnboardingWelcome onStart={noop} onSkip={noop} />
      </>
    );
  }
  const locale = i18n.language === 'ja' ? 'ja' : 'en';
  const phase: GuidePhase = kind === 'complete' ? 'done' : kind;
  const cards = sampleCards(locale, phase, AT);
  const lanes = {
    todo: cards.filter((card) => card.taskStatus === 'todo'),
    doing: cards.filter((card) => card.taskStatus === 'doing'),
    done: cards.filter((card) => card.taskStatus === 'done'),
  };
  const board = (
    <MockBoard
      count={cards.length}
      todo={lanes.todo.map(sampleCard)}
      doing={lanes.doing.map(sampleCard)}
      done={lanes.done.map(sampleCard)}
    />
  );
  if (kind === 'complete') {
    return (
      <>
        {board}
        <OnboardingComplete onFinish={noop} />
      </>
    );
  }
  const column = focusColumn(phase);
  const framed = column ? lanes[column] : [];
  const target: SpotlightRect | null = column
    ? { x: FRAME_X[column], y: 126, width: 268, height: 18 + framed.length * CARD_PITCH }
    : null;
  const index = ['request', 'planned', 'question', 'started', 'done'].indexOf(phase) + 1;
  const waiting = phase === 'question';
  return (
    <>
      {board}
      <OnboardingStage
        target={target}
        onExit={noop}
        renderTarget={column ? <MockStageCards cards={framed.map(sampleCard)} /> : null}
        guide={
          <OnboardingGuidePanel
            index={index}
            total={5}
            title={t(`onboarding.steps.${phase}.title`)}
            body={t(`onboarding.steps.${phase}.body`)}
            hint={t(
              waiting
                ? 'onboarding.guide.waitingHint'
                : phase === 'request'
                  ? 'onboarding.guide.requestHint'
                  : 'onboarding.guide.readFirst',
            )}
            waitingBadge={waiting ? t('onboarding.guide.waitingBadge') : undefined}
            actionLabel={t(
              phase === 'request' ? 'onboarding.guide.write' : 'onboarding.guide.next',
            )}
            onAction={noop}
            onExit={noop}
          />
        }
      />
    </>
  );
}
