import { ListFilterIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card } from '../../types';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/** Which tasks the list shows: the ones in this epic (as saved), the others, or both. */
export interface TaskFilter {
  thisEpic: boolean;
  other: boolean;
}

const ALL: TaskFilter = { thisEpic: true, other: true };

export interface EpicTaskListProps {
  /** Every task of the project (not archived). */
  cards: readonly Card[];
  /** The tasks in this epic when the dialog opened. They are listed first and the filter uses them. */
  initialMembers: ReadonlySet<number>;
  /** The tasks that are in this epic now, after the person's changes that are not saved yet. */
  members: ReadonlySet<number>;
  disabled: boolean;
  onToggle: (cardId: number, included: boolean) => void;
  onOpenTask: (cardId: number) => void;
}

/**
 * The task list under the outline of an epic. A check adds a task to the epic or takes it out; the
 * filter only changes what is shown when it is applied.
 */
export function EpicTaskList({
  cards,
  initialMembers,
  members,
  disabled,
  onToggle,
  onOpenTask,
}: EpicTaskListProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const [applied, setApplied] = useState<TaskFilter>(ALL);
  const [draft, setDraft] = useState<TaskFilter>(ALL);
  const [menuOpen, setMenuOpen] = useState(false);

  const rows = useMemo(() => {
    const ordered = cards.slice().sort((a, b) => {
      const rank = (card: Card) => (initialMembers.has(card.id) ? 0 : 1);
      return rank(a) - rank(b) || a.id - b.id;
    });
    return ordered.filter((card) =>
      initialMembers.has(card.id) ? applied.thisEpic : applied.other,
    );
  }, [cards, initialMembers, applied]);

  const stateOf = (card: Card) =>
    card.cardStatus === 'done'
      ? t('epic.taskDone')
      : card.cardStatus === 'doing'
        ? t('epic.taskDoing')
        : t('epic.taskTodo');

  return (
    <section className="epic-tasks" aria-labelledby={headingId}>
      <div className="epic-tasks__head">
        <h3 id={headingId} className="epic-tasks__title-text">
          {t('epic.tasks')}
        </h3>
        <span className="epic-tasks__dot" aria-hidden="true">
          ·
        </span>
        <span className="epic-tasks__count">{members.size}</span>
        <Popover
          open={menuOpen}
          onOpenChange={(open) => {
            // Opening the menu starts from what is applied; closing without Apply drops the choice.
            if (open) setDraft(applied);
            setMenuOpen(open);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="epic-tasks__filter"
              aria-label={t('epic.filter')}
              title={t('epic.filter')}
            >
              <ListFilterIcon aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="epic-filter" aria-label={t('epic.filterTitle')} align="end">
            <p className="epic-filter__title">{t('epic.filterTitle')}</p>
            <FilterChoice
              label={t('epic.filterAll')}
              checked={draft.thisEpic && draft.other}
              onChange={(checked) => setDraft({ thisEpic: checked, other: checked })}
            />
            <FilterChoice
              label={t('epic.filterThis')}
              checked={draft.thisEpic}
              onChange={(checked) => setDraft({ ...draft, thisEpic: checked })}
            />
            <FilterChoice
              label={t('epic.filterOther')}
              checked={draft.other}
              onChange={(checked) => setDraft({ ...draft, other: checked })}
            />
            <div className="epic-filter__actions">
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  setApplied(draft);
                  setMenuOpen(false);
                }}
              >
                {t('epic.filterApply')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {rows.length === 0 ? (
        <p className="epic-tasks__empty">{t('epic.noTasks')}</p>
      ) : (
        <ul className="epic-tasks__list" aria-label={t('epic.tasks')}>
          {rows.map((card) => (
            <li key={card.id} className="epic-tasks__row" data-task-id={card.id}>
              <Checkbox
                className="epic-tasks__check"
                checked={members.has(card.id)}
                disabled={disabled}
                aria-label={`${t('epic.include')}: ${card.title}`}
                onCheckedChange={(checked) => onToggle(card.id, checked === true)}
              />
              <div className="epic-tasks__body">
                <div className="epic-tasks__meta">
                  <span className="epic-tasks__id">#{card.id}</span>
                  <span className="epic-tasks__state">{stateOf(card)}</span>
                </div>
                <button
                  type="button"
                  className="epic-tasks__name"
                  disabled={disabled}
                  onClick={() => onOpenTask(card.id)}
                >
                  {card.title}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChoice({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="epic-filter__choice">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
