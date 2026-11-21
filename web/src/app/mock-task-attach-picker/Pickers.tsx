import { ChevronLeftIcon, SearchIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Checkbox } from '../../shared/ui/checkbox';
import { Input } from '../../shared/ui/input';
import { type Lane, matches, type MockTask, TASKS } from './data';
import { useLocale, useMockText } from './text';

const LANES: Lane[] = ['doing', 'todo', 'done'];

function TaskRow({
  task,
  checked,
  onToggle,
  showEpic,
}: {
  task: MockTask;
  checked: boolean;
  onToggle: () => void;
  showEpic?: boolean;
}) {
  const locale = useLocale();
  const m = useMockText();
  return (
    <li>
      <label className="ta-row" htmlFor={`ta-${task.id}`}>
        <Checkbox
          id={`ta-${task.id}`}
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={`#${task.id}`}
        />
        <span className="ta-row__text">
          <span className="ta-row__title">{task.title[locale]}</span>
          <span className="ta-row__meta">
            <span className="ta-row__id">#{task.id}</span>
            <Badge variant="outline">{m.lane[task.lane]}</Badge>
            {showEpic && <span className="ta-row__epic">{task.epic[locale]}</span>}
          </span>
        </span>
      </label>
    </li>
  );
}

function Search({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = useMockText();
  return (
    <div className="ta-search">
      <SearchIcon aria-hidden="true" />
      <Input
        aria-label={m.search}
        placeholder={m.search}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Option A body (also used by the popover): search, a flat list, and the confirm button. */
export function SheetPicker({
  variant,
  draft,
  toggle,
  onConfirm,
  onClose,
}: {
  variant: 'desktop' | 'phone';
  draft: number[];
  toggle: (id: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const m = useMockText();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const shown = TASKS.filter((task) => matches(task, query, locale));
  return (
    <div
      className={`ta-picker ta-picker--sheet ta-picker--${variant}`}
      role="dialog"
      aria-label={m.pickerTitle}
    >
      {variant === 'phone' && <span className="ta-grab" aria-hidden="true" />}
      <div className="ta-picker__head">
        <strong>{m.pickerTitle}</strong>
        <button type="button" className="ta-icon" aria-label={m.cancel} onClick={onClose}>
          <XIcon aria-hidden="true" />
        </button>
      </div>
      <Search value={query} onChange={setQuery} />
      <p className="ta-group">{m.recent}</p>
      <ul className="ta-list">
        {shown.length === 0 && <li className="ta-empty">{m.none}</li>}
        {shown.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            checked={draft.includes(task.id)}
            onToggle={() => toggle(task.id)}
          />
        ))}
      </ul>
      <div className="ta-picker__foot">
        <Button type="button" className="ta-confirm" onClick={onConfirm}>
          {m.confirm(draft.length)}
        </Button>
      </div>
    </div>
  );
}

/** Option C: a full-screen picker grouped by lane, with the confirm button in its header. */
export function FullPicker({
  variant,
  draft,
  toggle,
  onConfirm,
  onClose,
}: {
  variant: 'desktop' | 'phone';
  draft: number[];
  toggle: (id: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const m = useMockText();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  return (
    <div
      className={`ta-picker ta-picker--full ta-picker--${variant}`}
      role="dialog"
      aria-label={m.pickerTitle}
    >
      <div className="ta-full__head">
        <button type="button" className="ta-icon" aria-label={m.cancel} onClick={onClose}>
          <ChevronLeftIcon aria-hidden="true" />
        </button>
        <strong>{m.pickerTitle}</strong>
        <Button type="button" size="s" onClick={onConfirm}>
          {m.confirm(draft.length)}
        </Button>
      </div>
      <Search value={query} onChange={setQuery} />
      <div className="ta-full__scroll">
        {LANES.map((lane) => {
          const rows = TASKS.filter((t) => t.lane === lane && matches(t, query, locale));
          if (rows.length === 0) return null;
          return (
            <section key={lane}>
              <h3 className="ta-group ta-group--sticky">
                {m.lane[lane]} <span>{rows.length}</span>
              </h3>
              <ul className="ta-list">
                {rows.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    showEpic
                    checked={draft.includes(task.id)}
                    onToggle={() => toggle(task.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Option B: suggestions for the `#` being typed on the last line. */
export function Suggestions({
  query,
  taken,
  onPick,
}: {
  query: string;
  taken: number[];
  onPick: (id: number) => void;
}) {
  const m = useMockText();
  const locale = useLocale();
  const rows = TASKS.filter((t) => !taken.includes(t.id) && matches(t, query, locale)).slice(0, 4);
  return (
    <div className="ta-suggest" role="listbox" aria-label={m.pickerTitle}>
      <p className="ta-suggest__hint">{m.hint}</p>
      {rows.length === 0 && <p className="ta-empty">{m.none}</p>}
      {rows.map((task) => (
        <button
          key={task.id}
          type="button"
          role="option"
          aria-selected="false"
          className="ta-suggest__row"
          onClick={() => onPick(task.id)}
        >
          <span className="ta-row__id">#{task.id}</span>
          <span className="ta-row__title">{task.title[locale]}</span>
          <Badge variant="outline">{m.lane[task.lane]}</Badge>
        </button>
      ))}
    </div>
  );
}
