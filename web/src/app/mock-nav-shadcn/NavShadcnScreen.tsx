import {
  ArchiveIcon,
  KanbanIcon,
  MessageCircleQuestionIcon,
  SettingsIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneNavBar, type PhoneNavItem } from '../../pages/monitor/components/PhoneNavBar';
import { FIXTURE_CARDS, FIXTURE_LANES, type Lang } from './fixture-text';
import './nav-shadcn-mock.css';

export type NavVariant = 'current' | 'a' | 'b' | 'c';

export interface NavShadcnScreenProps {
  variant: NavVariant;
  /** The item shown as open. */
  current?: PhoneNavItem;
  /** Open questions: the count on Messages, hidden at 0. */
  questionCount?: number;
  archiveDisabled?: boolean;
}

const badgeText = (count: number) => (count > 9 ? '9+' : String(count));

interface Entry {
  id: PhoneNavItem;
  label: string;
  icon: LucideIcon;
  badge?: number;
  disabled?: boolean;
}

/**
 * The three shadcn-style bars. Same items and behavior as the product bar; only the look differs
 * (see `nav-shadcn-mock.css`).
 */
export function ShadcnNavBar({
  variant,
  current,
  questionCount = 0,
  archiveDisabled = false,
  onPick,
}: {
  variant: Exclude<NavVariant, 'current'>;
  current: PhoneNavItem;
  questionCount?: number;
  archiveDisabled?: boolean;
  onPick: (id: PhoneNavItem) => void;
}) {
  const { t } = useTranslation();
  const entries: Entry[] = [
    { id: 'board', label: t('monitor.nav.board'), icon: KanbanIcon },
    {
      id: 'messages',
      label: t('messages.title'),
      icon: MessageCircleQuestionIcon,
      badge: questionCount,
    },
    { id: 'ask', label: t('monitor.nav.ask'), icon: SparklesIcon },
    {
      id: 'archive',
      label: t('archive.title'),
      icon: ArchiveIcon,
      disabled: archiveDisabled,
    },
    { id: 'settings', label: t('settings.title'), icon: SettingsIcon },
  ];
  return (
    <nav className={`snav snav--${variant}`} aria-label={t('monitor.nav.label')}>
      {entries.map(({ id, label, icon: Icon, badge, disabled }) => (
        <button
          key={id}
          type="button"
          className={`snav__item${id === 'ask' ? ' snav__item--ask' : ''}`}
          aria-current={current === id ? 'page' : undefined}
          aria-label={[label, badge ? badgeText(badge) : ''].filter(Boolean).join(' ')}
          disabled={disabled}
          data-selected={current === id}
          onClick={() => onPick(id)}
        >
          <span className="snav__icon">
            <Icon aria-hidden="true" strokeWidth={1.75} />
            {badge ? (
              <span className="snav__badge" aria-hidden="true">
                {badgeText(badge)}
              </span>
            ) : null}
          </span>
          <span className="snav__label">{label}</span>
        </button>
      ))}
    </nav>
  );
}

/** A phone board with a bar at the bottom: the product bar (`current`) or one of the variants. */
export function NavShadcnScreen({
  variant,
  current: initial = 'board',
  questionCount = 3,
  archiveDisabled = false,
}: NavShadcnScreenProps) {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === 'ja' ? 'ja' : 'en';
  const [current, setCurrent] = useState<PhoneNavItem>(initial);
  return (
    <div className="nav-mock">
      <header className="nav-mock__head">
        <span className="nav-mock__project">agent-board</span>
      </header>
      <div className="nav-mock__tabs">
        {FIXTURE_LANES[lang].map((name, index) => (
          <span key={name} className="nav-mock__tab" data-selected={index === 1}>
            {name}
          </span>
        ))}
      </div>
      <ul className="nav-mock__list">
        {FIXTURE_CARDS.map((card) => (
          <li key={card.id} className="nav-mock__card">
            <span className="nav-mock__id">#{card.id}</span>
            <span className="nav-mock__title">{card.title[lang]}</span>
            <span className="nav-mock__tag" data-state={card.state}>
              {card.tag[lang]}
            </span>
          </li>
        ))}
      </ul>
      {variant === 'current' ? (
        <PhoneNavBar
          current={current}
          questionCount={questionCount}
          archiveDisabled={archiveDisabled}
          onBoard={() => setCurrent('board')}
          onMessages={() => setCurrent('messages')}
          onAsk={() => setCurrent('ask')}
          onArchive={() => setCurrent('archive')}
          onSettings={() => setCurrent('settings')}
        />
      ) : (
        <ShadcnNavBar
          variant={variant}
          current={current}
          questionCount={questionCount}
          archiveDisabled={archiveDisabled}
          onPick={setCurrent}
        />
      )}
    </div>
  );
}
