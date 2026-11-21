import { SearchIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { matchesPickerQuery, orderPickerTasks, type PickerTask } from './pickerTasks';
import './task-picker.css';

export interface TaskPickerState {
  tasks: readonly PickerTask[];
  query: string;
  setQuery: (query: string) => void;
  draft: readonly number[];
  toggle: (id: number) => void;
}

/**
 * The state of the "Attach task" picker: a search text and a draft of checked ids. The draft starts
 * from the ids on the request's last line, so reopening the picker shows what the text says. Ids the
 * list does not know stay in the draft, so a confirm never drops a reference the person typed.
 */
export function useTaskPicker(
  tasks: readonly PickerTask[],
  initial: readonly number[],
): TaskPickerState {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<number[]>(() => [...initial]);
  const shown = useMemo(
    () => orderPickerTasks(tasks).filter((task) => matchesPickerQuery(task, query)),
    [tasks, query],
  );
  const toggle = (id: number) =>
    setDraft((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  return { tasks: shown, query, setQuery, draft, toggle };
}

/** The search field and the checkbox list. A row is a label, so the whole row is the target. */
export function TaskPickerFields({ picker }: { picker: TaskPickerState }) {
  const { t } = useTranslation();
  const rowId = useId();
  return (
    <>
      <div className="task-picker__search">
        <SearchIcon aria-hidden="true" />
        <Input
          type="search"
          autoComplete="off"
          aria-label={t('askAi.attachSearch')}
          placeholder={t('askAi.attachSearch')}
          value={picker.query}
          onChange={(event) => picker.setQuery(event.target.value)}
        />
      </div>
      <ul className="task-picker__list" aria-label={t('askAi.attachTitle')}>
        {picker.tasks.length === 0 && (
          <li className="task-picker__empty">{t('askAi.attachNone')}</li>
        )}
        {picker.tasks.map((task) => (
          <li key={task.id}>
            <label className="task-picker__row" htmlFor={`${rowId}-${task.id}`}>
              <Checkbox
                id={`${rowId}-${task.id}`}
                checked={picker.draft.includes(task.id)}
                onCheckedChange={() => picker.toggle(task.id)}
              />
              <span className="task-picker__text">
                <span className="task-picker__name">{task.title}</span>
                <span className="task-picker__meta">
                  <span className="task-picker__id">#{task.id}</span>
                  <Badge variant="outline">{t(`column.${task.taskStatus}`)}</Badge>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

/** "Attach (N)": writes the draft to the request's last line. */
export function TaskPickerConfirm({
  picker,
  onConfirm,
}: {
  picker: TaskPickerState;
  onConfirm: (ids: number[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      className="task-picker__confirm"
      onClick={() => onConfirm([...picker.draft])}
    >
      {t('askAi.attachConfirm', { count: picker.draft.length })}
    </Button>
  );
}
