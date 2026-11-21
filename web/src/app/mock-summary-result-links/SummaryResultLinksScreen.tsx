import {
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageOffIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ResultsView } from '../../features/tasks/results/ResultsView';
import '../../features/tasks/messages/messages.css';
import '../../features/tasks/messages/summary.css';
import { buildSummaries, destinationResults, type MockResult, PICTURE } from './data';
import { useIsJa, useMockText } from './text';
import './result-links-mock.css';

export type LinkOption = 'underline' | 'row' | 'thumb';
type Variant = 'desktop' | 'phone';

export interface SummaryResultLinksScreenProps {
  variant: Variant;
  /** Which "looks like a link" treatment the result lines use. */
  option: LinkOption;
  /** The result already followed, so the destination shows at once. */
  opened?: { taskId: number; version: number };
}

interface RowProps {
  result: MockResult;
  option: LinkOption;
  onOpen: () => void;
}

/** One result line. It is a real link (`?task=&result=`) so a new-tab click still works; a plain click is handled in the page. */
function ResultLink({ result, option, onOpen }: RowProps) {
  const m = useMockText();
  return (
    <li className="summary-result rl-item">
      <a
        className="rl-link"
        data-option={option}
        href={`?task=${result.taskId}&result=${result.version}`}
        aria-label={m.openResult(result.taskId, result.version)}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
        {option === 'thumb' &&
          (result.picture ? (
            <img className="rl-link__thumb" src={PICTURE} alt="" />
          ) : (
            <span className="rl-link__thumb rl-link__thumb--none" role="img" aria-label={m.noImage}>
              <ImageOffIcon aria-hidden="true" />
            </span>
          ))}
        <span className="summary-result__id">#{result.taskId}</span>
        <span className="rl-link__text">
          <span className="rl-link__title">
            {result.title}
            {option === 'underline' && (
              <ArrowUpRightIcon className="rl-link__icon" aria-hidden="true" />
            )}
          </span>
          {option !== 'underline' && (
            <span className="rl-link__meta">{m.version(result.version)}</span>
          )}
        </span>
        {option === 'row' && <ChevronRightIcon className="rl-link__chevron" aria-hidden="true" />}
      </a>
    </li>
  );
}

function Destination({
  taskId,
  version,
  onBack,
}: {
  taskId: number;
  version: number;
  onBack: () => void;
}) {
  const m = useMockText();
  const ja = useIsJa();
  return (
    <div className="rl-destination">
      <button type="button" className="rl-back" onClick={onBack}>
        <ChevronLeftIcon aria-hidden="true" />
        {m.back}
      </button>
      <h3 className="rl-destination__title">
        <span className="summary-result__id">#{taskId}</span> {m.destination(taskId)}
      </h3>
      <ResultsView
        state={{ status: 'ready', results: destinationResults(ja) }}
        attachmentUrl={() => PICTURE}
        focusVersion={version}
      />
    </div>
  );
}

function Panel({ variant, option, opened }: SummaryResultLinksScreenProps) {
  const { t } = useTranslation();
  const ja = useIsJa();
  const [items, setItems] = useState(() => buildSummaries(ja));
  const [open, setOpen] = useState(opened ?? null);
  const tabs = [
    { id: 'fromAi', label: t('messages.list.tabFromAi'), count: 2 },
    { id: 'fromYou', label: t('messages.list.tabFromYou'), count: 1 },
    { id: 'summary', label: t('messages.summary.tab'), count: items.length },
  ];
  return (
    <section className="rl-panel" data-variant={variant} aria-label={t('messages.title')}>
      <header className="rl-panel__head">
        {variant === 'phone' && <span className="rl-grab" aria-hidden="true" />}
        <h2>{t('messages.title')}</h2>
        {variant === 'desktop' && (
          <button type="button" className="rl-close" aria-label={t('messages.list.close')}>
            <XIcon aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="rl-panel__body">
        {open ? (
          <Destination taskId={open.taskId} version={open.version} onBack={() => setOpen(null)} />
        ) : (
          <div className="message-list">
            <div
              className="message-tabs"
              role="tablist"
              aria-label={t('messages.list.tabs')}
              data-tabs="3"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  className="message-tabs__tab"
                  aria-selected={tab.id === 'summary'}
                >
                  {tab.label}
                  <strong>{tab.count}</strong>
                </button>
              ))}
            </div>
            <ul className="summary-list" aria-label={t('messages.summary.itemsLabel')}>
              {items.map((summary) => (
                <li key={summary.id} className="summary-item" data-variant={variant}>
                  <div className="summary-item__body">
                    <div className="summary-item__head">
                      <span className="summary-item__window">{summary.window}</span>
                      {variant === 'desktop' && (
                        <button
                          type="button"
                          className="summary-item__trash"
                          aria-label={t('messages.summary.delete')}
                          onClick={() => setItems((all) => all.filter((s) => s.id !== summary.id))}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <ul
                      className="summary-results rl-results"
                      data-option={option}
                      aria-label={t('messages.summary.resultsLabel')}
                    >
                      {summary.results.map((result) => (
                        <ResultLink
                          key={`${result.taskId}-${result.version}`}
                          result={result}
                          option={option}
                          onOpen={() => setOpen({ taskId: result.taskId, version: result.version })}
                        />
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** The Summary tab as a PC modal or a phone sheet, with result lines that read as links. */
export function SummaryResultLinksScreen(props: SummaryResultLinksScreenProps) {
  const key = `${props.option}:${props.opened?.taskId ?? ''}`;
  return (
    <div className={`rl-root rl-root--${props.variant}`}>
      {props.variant === 'desktop' && <div className="rl-backdrop" aria-hidden="true" />}
      <Panel key={key} {...props} />
    </div>
  );
}
