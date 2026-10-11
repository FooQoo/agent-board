import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { acceptanceProblem, nextId } from '../../lib/acceptance';
import type { AcceptanceItem } from '../../types';
import './acceptance-edit.css';

/**
 * The completion conditions of a card or epic, edited in its dialog. A new condition takes the next
 * number after every number shown, so a removed number is not reused. Moving changes only the order.
 */
export function AcceptanceEditor({
  id,
  items,
  onChange,
  disabled = false,
}: {
  /** Where the outline's link goes. */
  id?: string;
  items: readonly AcceptanceItem[];
  onChange: (items: AcceptanceItem[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  // Every ID this editor has shown, removed ones included.
  const everShown = useRef<string[]>([]);
  for (const item of items) {
    if (!everShown.current.includes(item.id)) everShown.current.push(item.id);
  }
  const [focusId, setFocusId] = useState<string | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (focusId === null) return;
    inputs.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const invalid = acceptanceProblem(items);
  const update = (index: number, change: Partial<AcceptanceItem>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const move = (index: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
  };
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const add = () => {
    const id = nextId(everShown.current);
    everShown.current.push(id);
    onChange([...items, { id, text: '', done: false }]);
    setFocusId(id);
  };

  return (
    <div className="acceptance-edit" id={id}>
      <div className="acceptance-edit__head">
        <span className="acceptance-edit__title">{t('acceptanceEdit.title')}</span>
        <span className="acceptance-edit__count">
          {t('acceptanceEdit.progress', {
            done: items.filter((item) => item.done).length,
            total: items.length,
          })}
        </span>
        <span className="acceptance-edit__saved">{t('acceptanceEdit.savedIn')}</span>
      </div>
      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled) return;
          const source = event.operation.source;
          if (!source || !isSortable(source)) return;
          const from = source.sortable.initialIndex;
          const to = source.sortable.index;
          if (from !== to) move(from, to);
        }}
      >
        <ol className="acceptance-edit__list">
          {items.map((item, index) => (
            <ConditionRow
              key={item.id}
              id={item.id}
              index={index}
              disabled={disabled}
              invalid={invalid === index}
              last={index === items.length - 1}
              item={item}
              setInput={(element) => {
                if (element) inputs.current.set(item.id, element);
                else inputs.current.delete(item.id);
              }}
              onUpdate={(change) => update(index, change)}
              onMove={(to) => move(index, to)}
              onRemove={() => remove(index)}
            />
          ))}
        </ol>
      </DragDropProvider>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="acceptance-edit__add"
        disabled={disabled}
        onClick={add}
      >
        <PlusIcon aria-hidden="true" focusable="false" />
        <span>{t('acceptanceEdit.add')}</span>
      </Button>
      <p className="acceptance-edit__note">{t('acceptanceEdit.numberNote')}</p>
    </div>
  );
}

/** One condition: its grip (drag to reorder), its controls, its text, and its remove button. */
function ConditionRow({
  id,
  index,
  item,
  disabled,
  invalid,
  last,
  setInput,
  onUpdate,
  onMove,
  onRemove,
}: {
  id: string;
  index: number;
  item: AcceptanceItem;
  disabled: boolean;
  invalid: boolean;
  last: boolean;
  setInput: (element: HTMLInputElement | null) => void;
  onUpdate: (change: Partial<AcceptanceItem>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled });
  return (
    <li
      ref={ref}
      className={isDragging ? 'acceptance-edit__row is-dragging' : 'acceptance-edit__row'}
      data-id={id}
    >
      <span className="acceptance-edit__controls">
        <span ref={handleRef} className="acceptance-edit__grip" aria-hidden="true">
          <GripVerticalIcon focusable="false" />
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="acceptance-edit__icon"
          aria-label={t('acceptanceEdit.moveUp', { id })}
          disabled={disabled || index === 0}
          onClick={() => onMove(index - 1)}
        >
          <ArrowUpIcon aria-hidden="true" focusable="false" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="acceptance-edit__icon"
          aria-label={t('acceptanceEdit.moveDown', { id })}
          disabled={disabled || last}
          onClick={() => onMove(index + 1)}
        >
          <ArrowDownIcon aria-hidden="true" focusable="false" />
        </Button>
        <Checkbox
          checked={item.done}
          disabled={disabled}
          aria-label={t('acceptanceEdit.done', { id })}
          onCheckedChange={(checked) => onUpdate({ done: checked === true })}
        />
        <span className="acceptance-edit__id">{id}</span>
      </span>
      <Input
        ref={setInput}
        type="text"
        className="acceptance-edit__text"
        value={item.text}
        disabled={disabled}
        placeholder={t('acceptanceEdit.placeholder')}
        aria-label={t('acceptanceEdit.text', { id })}
        aria-invalid={invalid ? 'true' : undefined}
        onChange={(event) => onUpdate({ text: event.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="acceptance-edit__icon"
        aria-label={t('acceptanceEdit.remove', { id })}
        disabled={disabled}
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" focusable="false" />
      </Button>
      {invalid && (
        <span className="acceptance-edit__error" role="alert">
          {t('acceptanceEdit.emptyText')}
        </span>
      )}
    </li>
  );
}
