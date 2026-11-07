import { Suspense, useId, useMemo } from 'react';
import type { AcceptanceItem } from '../../../shared/api/contracts';
import { preloadable } from '../../../shared/lib/lazy/preloadable';
import type { AttachmentResolver } from '../../../shared/markdown/model';
import './acceptance.css';

/** The Markdown renderer loads after the first screen; a condition shows as plain text until then. */
const blocksView = preloadable(() =>
  import('../../../shared/markdown/MarkdownBlocks').then((module) => module.MarkdownBlocks),
);

/** The text of one condition, drawn as the task body is. */
function ConditionText({
  id,
  text,
  resolveAttachment,
}: {
  id: string;
  text: string;
  resolveAttachment?: AttachmentResolver;
}) {
  const blocks = useMemo(
    () => [{ id: 'condition', kind: 'markdown' as const, source: text }],
    [text],
  );
  return (
    <div id={id} className="acceptance-view__text">
      <Suspense fallback={<p className="acceptance-view__plain">{text}</p>}>
        <blocksView.Component
          blocks={blocks}
          resolveAttachment={resolveAttachment}
          chapterHeadings
        />
      </Suspense>
    </div>
  );
}

/**
 * Shared rows and progress meter; the host owns tabs, folding and scrolling. Read-only unless the host
 * passes `onToggle`; then each checkbox can be changed, except the ones in `busy` while they save.
 * A checkbox takes its name from the drawn text, so a screen reader does not read the Markdown marks.
 */
export function AcceptanceList({
  items,
  progressItems = items,
  onToggle,
  busy,
  resolveAttachment,
}: {
  items: readonly AcceptanceItem[];
  progressItems?: readonly AcceptanceItem[];
  onToggle?: (item: AcceptanceItem, done: boolean) => void;
  busy?: ReadonlySet<string>;
  /** Turns an `attachment:<id>` image into its URL. */
  resolveAttachment?: AttachmentResolver;
}) {
  const textId = useId();
  return (
    <div className="acceptance-list">
      <div className="acceptance-view__meter" aria-hidden="true">
        {progressItems.map((item) => (
          <span
            key={item.id}
            className={item.done ? 'acceptance-view__segment is-done' : 'acceptance-view__segment'}
          />
        ))}
      </div>
      <ul className="acceptance-view__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={item.done ? 'acceptance-view__item is-done' : 'acceptance-view__item'}
          >
            {onToggle ? (
              <input
                type="checkbox"
                checked={item.done}
                disabled={busy?.has(item.id) ?? false}
                aria-labelledby={`${textId}-${item.id}`}
                onChange={(event) => onToggle(item, event.currentTarget.checked)}
              />
            ) : (
              <input
                type="checkbox"
                checked={item.done}
                disabled
                readOnly
                aria-labelledby={`${textId}-${item.id}`}
              />
            )}
            <span className="acceptance-view__id">{item.id}</span>
            <ConditionText
              id={`${textId}-${item.id}`}
              text={item.text}
              resolveAttachment={resolveAttachment}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
