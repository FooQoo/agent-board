import {
  ArchiveIcon,
  ArchiveXIcon,
  KanbanIcon,
  MessageCircleQuestionIcon,
  SettingsIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './phone-nav.css';

export type PhoneNavItem = 'board' | 'messages' | 'ask' | 'archive' | 'bulkArchive' | 'settings';

export interface PhoneNavBarProps {
  /** The item of whatever is open above the board; the board when nothing is. */
  current?: PhoneNavItem;
  /** The questions that wait for an answer: the count on Messages, hidden at 0. */
  questionCount?: number;
  /** There is no way to read the archive: the Archive item is dimmed and cannot be tapped. */
  archiveDisabled?: boolean;
  /** Nothing to archive in bulk (no done card): the button beside the bar is dimmed. */
  bulkArchiveDisabled?: boolean;
  onBoard: () => void;
  onMessages: () => void;
  onAsk: () => void;
  /** Opens the list of archived tasks. */
  onArchive: () => void;
  /** Opens the bulk-archive confirmation of the done lane. */
  onBulkArchive: () => void;
  onSettings: () => void;
}

interface Entry {
  id: PhoneNavItem;
  label: string;
  /** The name a screen reader hears, where it says more than the label. */
  name?: string;
  icon: LucideIcon;
  badge?: number;
  disabled?: boolean;
  onPick: () => void;
}

const badgeText = (count: number) => (count > 9 ? '9+' : String(count));

/**
 * The phone screen's bottom bar: Board, Messages, Ask, Archive and Settings. Ask sits in the
 * middle and is a little stronger than the rest. Everything except Board opens a drawer above the
 * board; Archive opens the list of archived tasks. Beside the dock, on its right, a round button
 * opens the bulk archive of the done lane. The bar keeps clear of the home indicator through the `--safe-*` variables.
 *
 * While it is mounted the root carries `data-phone-nav`, which gives `--phone-nav-height` its value
 * (see phone-nav.css): the sheets stop above the bar, and the bar stays in front of them and
 * stays tappable. Drawer ignores an outside tap on `[data-phone-nav-bar]` instead of dismissing.
 */
export function PhoneNavBar({
  current = 'board',
  questionCount = 0,
  archiveDisabled = false,
  bulkArchiveDisabled = false,
  onBoard,
  onMessages,
  onAsk,
  onArchive,
  onBulkArchive,
  onSettings,
}: PhoneNavBarProps) {
  const { t } = useTranslation();
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-phone-nav', '');
    return () => root.removeAttribute('data-phone-nav');
  }, []);
  const entries: Entry[] = [
    { id: 'board', label: t('monitor.nav.board'), icon: KanbanIcon, onPick: onBoard },
    {
      id: 'messages',
      label: t('messages.title'),
      icon: MessageCircleQuestionIcon,
      badge: questionCount,
      onPick: onMessages,
    },
    {
      id: 'ask',
      label: t('monitor.nav.ask'),
      name: t('askAi.button'),
      icon: SparklesIcon,
      onPick: onAsk,
    },
    {
      id: 'archive',
      label: t('archive.title'),
      name: t('archive.listTitle'),
      icon: ArchiveIcon,
      disabled: archiveDisabled,
      onPick: onArchive,
    },
    { id: 'settings', label: t('settings.title'), icon: SettingsIcon, onPick: onSettings },
  ];
  return (
    <nav className="phone-nav-bar" data-phone-nav-bar="" aria-label={t('monitor.nav.label')}>
      <div className="phone-nav">
        {entries.map(({ id, label, name, icon: Icon, badge, disabled, onPick }) => {
          const selected = current === id;
          return (
            <button
              key={id}
              type="button"
              className={`phone-nav__item${id === 'ask' ? ' phone-nav__item--ask' : ''}`}
              aria-current={selected ? 'page' : undefined}
              aria-label={[name ?? label, badge ? badgeText(badge) : ''].filter(Boolean).join(' ')}
              disabled={disabled}
              data-selected={selected}
              onClick={onPick}
            >
              <span className="phone-nav__icon">
                <Icon aria-hidden="true" />
                {badge ? (
                  <span className="phone-nav__badge" aria-hidden="true">
                    {badgeText(badge)}
                  </span>
                ) : null}
              </span>
              <span className="phone-nav__label">{label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="phone-nav__bulk"
        aria-label={t('monitor.lanes.bulkArchive')}
        aria-current={current === 'bulkArchive' ? 'page' : undefined}
        data-selected={current === 'bulkArchive'}
        disabled={bulkArchiveDisabled}
        onClick={onBulkArchive}
      >
        <ArchiveXIcon aria-hidden="true" />
      </button>
    </nav>
  );
}
