import { ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { progressOf } from '../../lib/acceptance';
import type { AcceptanceItem } from '../../types';
import { AcceptanceEditor } from './AcceptanceEditor';
import { AcceptanceView } from './AcceptanceView';
import './acceptance-edit.css';

/**
 * The completion conditions of a card or epic, held at the bottom of its dialog outside the scrolling
 * body. It starts folded to a line with the count; opening it shows the editor.
 */
export function ConditionsDock({
  id,
  items,
  onChange,
  disabled = false,
  readOnly = false,
}: {
  /** Where the outline's link goes. */
  id?: string;
  items: readonly AcceptanceItem[];
  onChange?: (items: AcceptanceItem[]) => void;
  disabled?: boolean;
  /** The detail panel shows the conditions and does not edit them. */
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const { done, total } = progressOf(items);
  return (
    <section className="conditions-dock" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="conditions-dock__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDownIcon
          aria-hidden="true"
          focusable="false"
          className="conditions-dock__chevron"
        />
        <span className="conditions-dock__title">{t('acceptanceEdit.title')}</span>
        <span className="conditions-dock__count">
          {t('acceptanceEdit.progress', { done, total })}
        </span>
      </button>
      <div id={bodyId} className="conditions-dock__body" hidden={!open}>
        {readOnly || onChange === undefined ? (
          <AcceptanceView items={items} />
        ) : (
          <AcceptanceEditor id={id} items={items} onChange={onChange} disabled={disabled} />
        )}
      </div>
    </section>
  );
}
