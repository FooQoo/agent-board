import { PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { acceptanceProblem, nextId } from './model/acceptance';
import type { AcceptanceItem } from '../../../shared/api/contracts';
import './acceptance-edit.css';

/**
 * The completion conditions of a card or epic, edited in its dialog. A new condition takes the next
 * number after every number shown, so a removed number is not reused. The order is kept as it is.
 */
export function AcceptanceEditor({
  id,
  items,
  onChange,
  disabled = false,
  embedded = false,
}: {
  /** Where the outline's link goes. */
  id?: string;
  items: readonly AcceptanceItem[];
  onChange: (items: AcceptanceItem[]) => void;
  disabled?: boolean;
  embedded?: boolean;
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
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const add = () => {
    const id = nextId(everShown.current);
    everShown.current.push(id);
    onChange([...items, { id, text: '', done: false }]);
    setFocusId(id);
  };

  return (
    <div className="acceptance-edit" id={id} data-embedded={embedded ? 'true' : undefined}>
      {!embedded && (
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
      )}
      <ol className="acceptance-edit__list">
        {items.map((item, index) => (
          <ConditionRow
            key={item.id}
            id={item.id}
            disabled={disabled}
            invalid={invalid === index}
            item={item}
            setInput={(element) => {
              if (element) inputs.current.set(item.id, element);
              else inputs.current.delete(item.id);
            }}
            onUpdate={(change) => update(index, change)}
            onRemove={() => remove(index)}
          />
        ))}
      </ol>
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

/** One condition: its check, its number, its text, and its remove button. */
function ConditionRow({
  id,
  item,
  disabled,
  invalid,
  setInput,
  onUpdate,
  onRemove,
}: {
  id: string;
  item: AcceptanceItem;
  disabled: boolean;
  invalid: boolean;
  setInput: (element: HTMLInputElement | null) => void;
  onUpdate: (change: Partial<AcceptanceItem>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="acceptance-edit__row" data-id={id}>
      <span className="acceptance-edit__controls">
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
