import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { progressOf } from './model/acceptance';
import type { AcceptanceItem } from '../../../shared/api/contracts';
import './acceptance-edit.css';

/**
 * The first item of an edit dialog's outline: it moves the view to the conditions above the body, and
 * the URL stays as it is. It is a link, not a heading, and shows the same count as the conditions.
 */
export function ConditionsLink({ id, items }: { id: string; items: readonly AcceptanceItem[] }) {
  const { t } = useTranslation();
  const { done, total } = progressOf(items);
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const dock = document.getElementById(id);
    dock?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click();
    dock?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  };
  return (
    <a className="acceptance-outline-link" href={`#${id}`} onClick={open}>
      {t('acceptanceEdit.sectionLink', { done, total })}
    </a>
  );
}
