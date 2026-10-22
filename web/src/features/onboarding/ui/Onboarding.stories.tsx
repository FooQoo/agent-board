import '../../../shared/i18n/onboarding-strings';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { useTranslation } from 'react-i18next';
import type { SpotlightRect } from '../../../shared/ui/spotlight/Spotlight';
import { OnboardingComplete } from './OnboardingComplete';
import { OnboardingGuidePanel } from './OnboardingGuidePanel';
import { OnboardingNotice } from './OnboardingNotice';
import { OnboardingStage } from './OnboardingStage';
import { OnboardingWelcome } from './OnboardingWelcome';
import './onboarding.css';

/*
 * The guide parts with neutral stand-ins for the board. The full screens of the approved mock, which
 * use the product's header, task card and answer form, are composed in app/onboarding.
 */

type ScreenKind =
  | 'welcome'
  | 'samples'
  | 'running'
  | 'pending'
  | 'resumed'
  | 'complete'
  | 'archived';

const TARGET_SAMPLES: SpotlightRect = { x: 30, y: 126, width: 390, height: 220 };
const TARGET_RUNNING: SpotlightRect = { x: 442, y: 126, width: 396, height: 118 };
const TARGET_PENDING: SpotlightRect = { x: 442, y: 126, width: 396, height: 496 };

/** A stand-in card with the mock's size and spacing, so the guide's spotlight has something to frame. */
function StandInCard({ title }: { title: string }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        height: 90,
        padding: '14px 16px',
        borderRadius: 8,
        background: 'var(--r-surface)',
        color: 'var(--r-text)',
        fontSize: 14,
      }}
    >
      {title}
    </div>
  );
}

function StandInStage({
  target,
  cards,
  guide,
}: {
  target: SpotlightRect;
  cards: ReactNode[];
  guide: ReactNode;
}) {
  return (
    <OnboardingStage
      target={target}
      onExit={fn()}
      renderTarget={
        <div
          style={{
            position: 'absolute',
            inset: 0,
            padding: '9px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {cards}
        </div>
      }
      guide={guide}
    />
  );
}

function GuideScreen({ kind }: { kind: ScreenKind }) {
  const { t } = useTranslation();
  const total = 4;
  const panel = (
    index: number,
    key: 'samples' | 'running' | 'pending' | 'resumed',
    extra: Partial<Parameters<typeof OnboardingGuidePanel>[0]> = {},
  ) => (
    <OnboardingGuidePanel
      index={index}
      total={total}
      title={t(`onboarding.steps.${key}.title`)}
      body={t(`onboarding.steps.${key}.body`)}
      hint={t('onboarding.guide.readFirst')}
      actionLabel={t('onboarding.guide.next')}
      busy={false}
      error={null}
      onAction={fn()}
      onExit={fn()}
      {...extra}
    />
  );
  switch (kind) {
    case 'welcome':
      return <OnboardingWelcome busy={false} error={null} onStart={fn()} onSkip={fn()} />;
    case 'samples':
      return (
        <StandInStage
          target={TARGET_SAMPLES}
          cards={[<StandInCard key="a" title="1" />, <StandInCard key="b" title="2" />]}
          guide={panel(1, 'samples', { actionLabel: t('onboarding.guide.watch') })}
        />
      );
    case 'running':
      return (
        <StandInStage
          target={TARGET_RUNNING}
          cards={[<StandInCard key="a" title="1" />]}
          guide={panel(2, 'running')}
        />
      );
    case 'pending':
      return (
        <StandInStage
          target={TARGET_PENDING}
          cards={[<StandInCard key="p" title="2" />]}
          guide={panel(3, 'pending', {
            waitingBadge: t('onboarding.guide.waitingBadge'),
            hint: t('onboarding.guide.waitingHint'),
          })}
        />
      );
    case 'resumed':
      return (
        <StandInStage
          target={{ x: 442, y: 126, width: 396, height: 118 }}
          cards={[<StandInCard key="r" title="2" />]}
          guide={panel(4, 'resumed')}
        />
      );
    case 'complete':
      return <OnboardingComplete busy={false} error={null} onFinish={fn()} />;
    case 'archived':
      return <OnboardingNotice message={t('onboarding.archived')} />;
  }
}

const meta = {
  title: 'Features/Onboarding/Guide',
  component: GuideScreen,
  parameters: { layout: 'fullscreen' },
  args: { kind: 'welcome' },
} satisfies Meta<typeof GuideScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {
  args: { kind: 'welcome' },
  play: async () => {
    await expect(within(document.body).getByRole('dialog')).toBeInTheDocument();
  },
};
export const SamplesCreated: Story = { args: { kind: 'samples' } };
export const AutomaticProgress: Story = { args: { kind: 'running' } };
export const DecisionNeeded: Story = { args: { kind: 'pending' } };
export const ResumedAfterAnswer: Story = { args: { kind: 'resumed' } };
export const Completed: Story = { args: { kind: 'complete' } };
export const Archived: Story = { args: { kind: 'archived' } };
