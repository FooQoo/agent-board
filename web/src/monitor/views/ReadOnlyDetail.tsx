import { LayersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatShort } from '../../lib/format';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CardDetailView } from '../../components/detail/CardDetailView';
import type { DetailTab } from '../../components/detail/DetailTabs';
import type { MonitorViewProps } from '../contracts';
import { ReadOnlyEpic } from './ReadOnlyEpic';

export function ReadOnlyDetail(props: MonitorViewProps) {
  const { t } = useTranslation();
  const [epicId, setEpicId] = useState<string | null>(null);
  const selected = props.selectedCard;
  const tab: DetailTab =
    props.tab === 'history' ||
    (!props.tab && new URLSearchParams(window.location.search).get('tab') === 'history')
      ? 'history'
      : 'description';
  const card = selected
    ? {
        ...selected.card,
        description: props.body ?? selected.card.description,
        history: props.history ?? selected.card.history,
      }
    : null;
  const open = selected !== null;
  const onOpenChange = (value: boolean) => {
    if (!value) props.onCloseCard();
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="monitor-detail-dialog"
          showCloseButton={false}
          aria-labelledby="monitor-dialog-title"
          aria-describedby={undefined}
        >
          <DialogTitle className="visually-hidden" id="monitor-dialog-title">
            {t('detail.title')}
          </DialogTitle>
          {selected && card && (
            <>
              {card.epic && (
                <Button
                  type="button"
                  variant="ghost"
                  className="monitor-epic-link"
                  onClick={() => setEpicId(card.epic?.id ?? null)}
                >
                  <LayersIcon aria-hidden="true" />
                  {card.epic.id} · {card.epic.name}
                </Button>
              )}
              <CardDetailView
                projectId={selected.projectId}
                card={card}
                tab={tab}
                onTabChange={(value) => props.onTabChange(value === 'history' ? 'history' : 'body')}
                onClose={props.onCloseCard}
                ownerName={selected.projectName}
                statusLabels="monitor"
                attachmentUrl={(id) =>
                  props.readResolvers.attachmentUrl(selected.projectId, card.id, id)
                }
                evidenceUrl={(id) =>
                  props.readResolvers.evidenceUrl(selected.projectId, card.id, id)
                }
                problems={props.freshness.snapshotProblems
                  .filter((problem) => problem.projectId === selected.projectId)
                  .map(({ file, field, reason }) => ({ file, field, reason }))}
              />
              <footer className="monitor-detail-footer">
                {t('monitor.detailFooter', {
                  time: props.freshness.lastFetchedAt
                    ? formatShort(props.freshness.lastFetchedAt)
                    : '',
                })}
              </footer>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ReadOnlyEpic
        epicId={epicId}
        projectId={selected?.projectId ?? null}
        resolvers={props.readResolvers}
        onClose={() => setEpicId(null)}
      />
    </>
  );
}
