import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
      <ol className="acceptance-edit__list">
        {items.map((item, index) => (
          <li key={item.id} className="acceptance-edit__row">
            <span className="acceptance-edit__controls">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="acceptance-edit__icon"
                aria-label={t('acceptanceEdit.moveUp', { id: item.id })}
                disabled={disabled || index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUpIcon aria-hidden="true" focusable="false" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="acceptance-edit__icon"
                aria-label={t('acceptanceEdit.moveDown', { id: item.id })}
                disabled={disabled || index === items.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDownIcon aria-hidden="true" focusable="false" />
              </Button>
              <Checkbox
                checked={item.done}
                disabled={disabled}
                aria-label={t('acceptanceEdit.done', { id: item.id })}
                onCheckedChange={(checked) => update(index, { done: checked === true })}
              />
              <span className="acceptance-edit__id">{item.id}</span>
            </span>
            <Input
              ref={(element) => {
                if (element) inputs.current.set(item.id, element);
                else inputs.current.delete(item.id);
              }}
              type="text"
              className="acceptance-edit__text"
              value={item.text}
              disabled={disabled}
              placeholder={t('acceptanceEdit.placeholder')}
              aria-label={t('acceptanceEdit.text', { id: item.id })}
              aria-invalid={invalid === index ? 'true' : undefined}
              onChange={(event) => update(index, { text: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="acceptance-edit__icon"
              aria-label={t('acceptanceEdit.remove', { id: item.id })}
              disabled={disabled}
              onClick={() => remove(index)}
            >
              <XIcon aria-hidden="true" focusable="false" />
            </Button>
            {invalid === index && (
              <span className="acceptance-edit__error" role="alert">
                {t('acceptanceEdit.emptyText')}
              </span>
            )}
          </li>
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
