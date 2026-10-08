import { useEffect, useState } from 'react';
import { ArchiveIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { archiveDone, fetchArchive, restoreCard, type ArchiveResponse } from '../api';
import type { Card, ProjectId } from '../types';
import { AssigneeLabel } from './AssigneeLabel';
import { DetailPanel } from './DetailPanel';
import { StatusLabel } from './StatusLabel';

export function ArchiveView({ projectId, onBack }: { projectId: ProjectId; onBack: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<ArchiveResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setFailed(false);
    void fetchArchive(projectId).then(setData, () => setFailed(true));
  };
  useEffect(load, [projectId]);
  const selected = data?.cards.find((card) => card.id === selectedId) ?? null;
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setSelectedId(null);
      load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="archive-view">
      <header className="archive-view__header">
        <div>
          <p className="archive-view__eyebrow">
            <ArchiveIcon aria-hidden="true" /> {t('archive.title')}
          </p>
          <h2>{t('archive.heading')}</h2>
        </div>
        <button type="button" className="archive-view__back" onClick={onBack}>
          {t('archive.back')}
        </button>
      </header>
      {failed ? (
        <div className="archive-view__empty">
          <p>{t('archive.loadError')}</p>
          <button type="button" onClick={load}>
            {t('board.retry')}
          </button>
        </div>
      ) : data === null ? (
        <div className="archive-view__empty">
          <p>{t('board.loading')}</p>
        </div>
      ) : data.cards.length === 0 ? (
        <div className="archive-view__empty">
          <ArchiveIcon aria-hidden="true" />
          <p>{t('archive.empty')}</p>
        </div>
      ) : (
        <div className="archive-view__body">
          <div className="archive-list" role="list" aria-label={t('archive.title')}>
            {data.cards.map((card) => (
              <button
                type="button"
                className={`archive-row${card.id === selectedId ? ' archive-row--selected' : ''}`}
                key={card.id}
                onClick={() => setSelectedId(card.id)}
              >
                <span className="archive-row__id">#{card.id}</span>
                <span className="archive-row__title">{card.title}</span>
                <StatusLabel kind="card" status={card.cardStatus} />
                <AssigneeLabel assignee={card.assignee} />
                <span className="archive-row__date">{card.archivedAt?.slice(0, 10)}</span>
              </button>
            ))}
          </div>
          {selected && (
            <DetailPanel
              projectId={projectId}
              card={selected}
              archived
              onClose={() => setSelectedId(null)}
              onDeleted={() => {
                setSelectedId(null);
                load();
              }}
              onRestore={() => void perform(() => restoreCard(projectId, selected.id))}
            />
          )}
        </div>
      )}
      {busy && (
        <span className="archive-view__busy" role="status">
          {t('dialog.saving')}
        </span>
      )}
    </main>
  );
}

export function BulkArchiveDialog({
  projectId,
  cards,
  onClose,
  onDone,
}: {
  projectId: ProjectId;
  cards: Card[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [targets] = useState(cards);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (targets.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      await archiveDone(
        projectId,
        targets.map((card) => card.id),
      );
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('archive.error'));
      setBusy(false);
    }
  };
  return (
    <div
      className="bulk-archive"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-archive-title"
    >
      <div className="bulk-archive__panel">
        <h2 id="bulk-archive-title">{t('archive.bulkTitle')}</h2>
        <p>{t('archive.bulkDescription', { count: targets.length })}</p>
        <div className="bulk-archive__table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('archive.cardTitle')}</th>
                <th>{t('archive.assignee')}</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((card) => (
                <tr key={card.id}>
                  <td>#{card.id}</td>
                  <td>{card.title}</td>
                  <td>
                    <AssigneeLabel assignee={card.assignee} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && (
          <p className="archive-error" role="alert">
            {error}
          </p>
        )}
        <div className="bulk-archive__actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {t('delete.cancel')}
          </button>
          <button
            type="button"
            className="bulk-archive__submit"
            onClick={() => void submit()}
            disabled={busy || targets.length === 0}
          >
            {busy ? t('dialog.saving') : t('archive.bulkSubmit', { count: targets.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
