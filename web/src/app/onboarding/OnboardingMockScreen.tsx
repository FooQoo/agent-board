import { useTranslation } from 'react-i18next';
import { DecisionRequestFormView } from '../../features/tasks/answer/DecisionRequestFormView';
import { TaskCardView } from '../../features/tasks/card/TaskCard';
import type { SpotlightRect } from '../../shared/ui/spotlight/Spotlight';
import { OnboardingComplete } from '../../features/onboarding/ui/OnboardingComplete';
import { OnboardingGuidePanel } from '../../features/onboarding/ui/OnboardingGuidePanel';
import { OnboardingNotice } from '../../features/onboarding/ui/OnboardingNotice';
import { OnboardingStage } from '../../features/onboarding/ui/OnboardingStage';
import { OnboardingWelcome } from '../../features/onboarding/ui/OnboardingWelcome';
import '../../features/onboarding/ui/onboarding.css';
import { MockBoard, MockStageCards } from './MockBoard';
import { doneSample, pendingSample, resumedSample, runningSample, samples } from './mock-data';

export type ScreenKind =
  | 'welcome'
  | 'samples'
  | 'running'
  | 'pending'
  | 'resumed'
  | 'complete'
  | 'archived';

const noop = () => {};

const TARGET_SAMPLES: SpotlightRect = { x: 30, y: 126, width: 268, height: 220 };
const TARGET_RUNNING: SpotlightRect = { x: 326, y: 126, width: 268, height: 118 };
const TARGET_PENDING: SpotlightRect = { x: 326, y: 126, width: 268, height: 496 };
const TARGET_RESUMED: SpotlightRect = { x: 326, y: 126, width: 268, height: 118 };

/** The sample answer form inside the pending card, with the controls of the approved mock. */
function SampleAnswerForm() {
  return (
    <DecisionRequestFormView
      question={pendingSample.pendingReason}
      choices={pendingSample.pendingChoices}
      model={{
        choiceId: null,
        text: '',
        questionExpanded: true,
        phase: 'editing',
        message: null,
        tooLong: false,
        sendable: false,
        disabled: true,
      }}
      onChoiceChange={noop}
      onTextChange={noop}
      onExpandQuestion={noop}
      onClear={noop}
      onSubmit={noop}
    />
  );
}

/** One screen of the approved mock. The story picks the parts that the screen shows. */
export function OnboardingMockScreen({ kind }: { kind: ScreenKind }) {
  const { t } = useTranslation();
  const total = 4;
  const body = (key: 'samples' | 'running' | 'pending' | 'resumed') =>
    t(`onboarding.steps.${key}.body`);
  switch (kind) {
    case 'welcome':
      return (
        <>
          <MockBoard count={0} />
          <OnboardingWelcome busy={false} error={null} onStart={noop} onSkip={noop} />
        </>
      );
    case 'samples':
      return (
        <>
          <MockBoard
            count={2}
            todo={[
              <TaskCardView key="a" task={samples.follow} selected={false} onSelect={noop} />,
              <TaskCardView key="b" task={samples.style} selected={false} onSelect={noop} />,
            ]}
          />
          <OnboardingStage
            target={TARGET_SAMPLES}
            onExit={noop}
            renderTarget={
              <MockStageCards
                cards={[
                  <TaskCardView key="a" task={samples.follow} selected={false} onSelect={noop} />,
                  <TaskCardView key="b" task={samples.style} selected={false} onSelect={noop} />,
                ]}
              />
            }
            guide={
              <OnboardingGuidePanel
                index={1}
                total={total}
                title={t('onboarding.steps.samples.title')}
                body={body('samples')}
                hint={t('onboarding.guide.readFirst')}
                actionLabel={t('onboarding.guide.watch')}
                busy={false}
                error={null}
                onAction={noop}
                onExit={noop}
              />
            }
          />
        </>
      );
    case 'running':
      return (
        <>
          <MockBoard
            count={2}
            todo={[<TaskCardView key="b" task={samples.style} selected={false} onSelect={noop} />]}
            doing={[<TaskCardView key="a" task={runningSample} selected={false} onSelect={noop} />]}
          />
          <OnboardingStage
            target={TARGET_RUNNING}
            onExit={noop}
            renderTarget={
              <MockStageCards
                cards={[
                  <TaskCardView key="a" task={runningSample} selected={false} onSelect={noop} />,
                ]}
              />
            }
            guide={
              <OnboardingGuidePanel
                index={2}
                total={total}
                title={t('onboarding.steps.running.title')}
                body={body('running')}
                hint={t('onboarding.guide.readFirst')}
                actionLabel={t('onboarding.guide.next')}
                busy={false}
                error={null}
                onAction={noop}
                onExit={noop}
              />
            }
          />
        </>
      );
    case 'pending':
      return (
        <>
          <MockBoard
            count={2}
            doing={[
              <TaskCardView
                key="p"
                task={pendingSample}
                selected={false}
                showPendingReason={false}
                onSelect={noop}
              >
                <SampleAnswerForm />
              </TaskCardView>,
            ]}
            done={[<TaskCardView key="a" task={doneSample} selected={false} onSelect={noop} />]}
          />
          <OnboardingStage
            target={TARGET_PENDING}
            onExit={noop}
            renderTarget={
              <MockStageCards
                cards={[
                  <TaskCardView
                    key="p"
                    task={pendingSample}
                    selected={false}
                    showPendingReason={false}
                    onSelect={noop}
                  >
                    <SampleAnswerForm />
                  </TaskCardView>,
                ]}
              />
            }
            guide={
              <OnboardingGuidePanel
                index={3}
                total={total}
                title={t('onboarding.steps.pending.title')}
                body={body('pending')}
                hint={t('onboarding.guide.waitingHint')}
                waitingBadge={t('onboarding.guide.waitingBadge')}
                actionLabel={t('onboarding.guide.next')}
                busy={false}
                error={null}
                onAction={noop}
                onExit={noop}
              />
            }
          />
        </>
      );
    case 'resumed':
      return (
        <>
          <MockBoard
            count={2}
            doing={[<TaskCardView key="r" task={resumedSample} selected={false} onSelect={noop} />]}
            done={[<TaskCardView key="a" task={doneSample} selected={false} onSelect={noop} />]}
          />
          <OnboardingStage
            target={TARGET_RESUMED}
            onExit={noop}
            renderTarget={
              <MockStageCards
                cards={[
                  <TaskCardView key="r" task={resumedSample} selected={false} onSelect={noop} />,
                ]}
              />
            }
            guide={
              <OnboardingGuidePanel
                index={4}
                total={total}
                title={t('onboarding.steps.resumed.title')}
                body={body('resumed')}
                hint={t('onboarding.guide.readFirst')}
                actionLabel={t('onboarding.guide.next')}
                busy={false}
                error={null}
                onAction={noop}
                onExit={noop}
              />
            }
          />
        </>
      );
    case 'complete':
      return (
        <>
          <MockBoard
            count={2}
            done={[
              <TaskCardView key="a" task={doneSample} selected={false} onSelect={noop} />,
              <TaskCardView
                key="b"
                task={{ ...samples.style, taskStatus: 'done', agentStatus: 'idle' }}
                selected={false}
                onSelect={noop}
              />,
            ]}
          />
          <OnboardingComplete busy={false} error={null} onFinish={noop} />
        </>
      );
    case 'archived':
      return (
        <>
          <MockBoard count={0} emptyHint={t('onboarding.mock.emptyHint')} />
          <OnboardingNotice message={t('onboarding.archived')} />
        </>
      );
  }
}
