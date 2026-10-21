import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailPanel } from '../../features/tasks/detail/DetailPanel';
import { Header } from '../../shared/ui/app-header/Header';
import { SAMPLE_PROJECT } from './mock-data';

/** The mock's controls do nothing; the stories show their state, not their behaviour. */
const noop = () => {};

export const LANE_X = [24, 320, 616] as const;
export const LANE_TOP = 80;
export const LANE_WIDTH = 280;
export const LANE_HEIGHT = 756;
export const CARD_LEFT = 12;
export const CARD_WIDTH = 256;
export const CARD_PITCH = 101;
export const CARD_TOP = 50;

const RESULT_LANE_NAMES = {
  en: ['To do', 'In progress', 'Done'],
  ja: ['未着手', '進行中', '完了'],
} as const;

/** The shared background of every screen: the app header, the three lanes, and the status bar. */
export function MockBoard({
  todo = [],
  doing = [],
  done = [],
}: {
  todo?: ReactNode[];
  doing?: ReactNode[];
  done?: ReactNode[];
}) {
  const { i18n } = useTranslation();
  const names = i18n.language === 'ja' ? RESULT_LANE_NAMES.ja : RESULT_LANE_NAMES.en;
  const lanes = [todo, doing, done];
  return (
    <div
      className="onboarding-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'var(--r-bg)' }}
    >
      <Header
        projects={[SAMPLE_PROJECT]}
        activeProjectId={SAMPLE_PROJECT.id}
        canAdd
        onAdd={noop}
        onArchive={noop}
        onEpics={noop}
        projectSwitcher={<span>{SAMPLE_PROJECT.name}</span>}
      />
      {lanes.map((cards, index) => (
        <div
          key={names[index]}
          style={{
            position: 'absolute',
            left: LANE_X[index],
            top: LANE_TOP,
            width: LANE_WIDTH,
            height: LANE_HEIGHT,
            borderRadius: 12,
            background: 'var(--r-lane)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 18,
              top: 16,
              color: 'var(--r-text2)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {names[index]}{' '}
            <span style={{ color: 'var(--r-muted)', fontWeight: 400, fontSize: 12 }}>
              {cards.length}
            </span>
          </div>
          {cards.map((card, cardIndex) => (
            <div
              key={cardIndex}
              style={{
                position: 'absolute',
                left: CARD_LEFT,
                top: CARD_TOP + cardIndex * CARD_PITCH,
                width: CARD_WIDTH,
              }}
            >
              {card}
            </div>
          ))}
        </div>
      ))}
      <div style={{ position: 'absolute', left: 920, top: 56, width: 360, height: 804 }}>
        <DetailPanel projectId={null} task={null} onClose={noop} onRemove={async () => false} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          background: 'var(--r-surface)',
          borderTop: '1px solid var(--r-border)',
          color: 'var(--r-muted)',
          fontSize: 12,
        }}
      >
        <span>{i18n.language === 'ja' ? '2件' : '2 items'}</span>
        <span>{i18n.language === 'ja' ? '同期済み 10:42' : 'Synced 10:42'}</span>
      </div>
    </div>
  );
}

/** Places the cards of a spotlighted lane. The frame keeps the mock's 3px ring outside the region. */
export function MockStageCards({
  cards,
  left = 6,
  top = 4,
}: {
  cards: ReactNode[];
  left?: number;
  top?: number;
}) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      {cards.map((card, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            left,
            top: top + index * CARD_PITCH,
            width: CARD_WIDTH,
          }}
        >
          {card}
        </div>
      ))}
    </div>
  );
}
