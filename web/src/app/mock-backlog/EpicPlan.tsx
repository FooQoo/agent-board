import { PencilLineIcon } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { AcceptanceList } from '../../features/tasks/acceptance/AcceptanceList';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { MarkdownBlocks } from '../../shared/markdown/MarkdownBlocks';
import { countIn, type Fixture, type MockCard } from './data';
import { Surface } from './Surface';
import { useMockText } from './text';
import './backlog-mock.css';

/**
 * The whole plan of an epic in one flow: its goal, then the tasks in wave order, each with its
 * acceptance conditions. Backlog cards can be picked here; the footer sends the pick or the whole epic.
 */
export function EpicPlan({
  kind,
  fixture,
  cards,
  epicId,
  selected,
  onToggle,
  onEdit,
  onSendSelected,
  onSendEpic,
  onClose,
}: {
  kind: 'dialog' | 'sheet';
  fixture: Fixture;
  cards: readonly MockCard[];
  epicId: string;
  selected: readonly number[];
  onToggle: (id: number) => void;
  onEdit: (id: number) => void;
  onSendSelected: () => void;
  onSendEpic: () => void;
  onClose: () => void;
}) {
  const m = useMockText();
  const epic = fixture.epics.find((item) => item.id === epicId);
  const own = cards.filter((card) => card.epicId === epicId);
  const waves = useMemo(
    () => [...new Set(own.map((card) => card.wave))].sort((a, b) => a - b),
    [own],
  );
  const inBacklog = own.filter((card) => card.lane === 'backlog');
  const picked = selected.filter((id) => inBacklog.some((card) => card.id === id));
  const goal = (fixture.epicBody[epicId] ?? '').replace(/^# .*\n\n?/, '');
  const goalBlocks = useMemo(
    () => [{ id: 'goal', kind: 'markdown' as const, source: goal }],
    [goal],
  );
  return (
    <Surface
      kind={kind}
      title={m.planTitle(epicId)}
      identity={epic?.name ?? ''}
      onClose={onClose}
      className="bplan"
      footer={
        <>
          <p className="bplan__progress">
            {m.planProgress(inBacklog.length, countIn(own, 'todo'))}
          </p>
          <DialogActions>
            <Button
              type="button"
              variant="outline"
              disabled={picked.length === 0}
              onClick={onSendSelected}
            >
              {m.sendSelected(picked.length)}
            </Button>
            <Button type="button" disabled={inBacklog.length === 0} onClick={onSendEpic}>
              {m.sendEpic(inBacklog.length)}
            </Button>
          </DialogActions>
        </>
      }
    >
      <div className="bplan__body">
        <section className="bplan__goal">
          <h3 className="bplan__h">1. {m.planGoal}</h3>
          <div className="bplan__goal-text">
            <MarkdownBlocks blocks={goalBlocks} chapterHeadings />
          </div>
        </section>
        <h3 className="bplan__h">2. {m.planOrder}</h3>
        <p className="bplan__note">{m.planReadOnlyNote}</p>
        {waves.map((wave) => (
          <Fragment key={wave}>
            <h4 className="bplan__wave">{m.waveLabel(wave)}</h4>
            <ol className="bplan__cards">
              {own
                .filter((card) => card.wave === wave)
                .map((card) => (
                  <li key={card.id} className="bplan__card" data-lane={card.lane}>
                    <div className="bplan__head">
                      {card.lane === 'backlog' ? (
                        <Checkbox
                          checked={selected.includes(card.id)}
                          aria-label={m.selectCard(card.id)}
                          onCheckedChange={() => onToggle(card.id)}
                        />
                      ) : (
                        <span className="bplan__nocheck" aria-hidden="true" />
                      )}
                      <span className="bplan__id">#{card.id}</span>
                      <span className="bplan__title">{card.title}</span>
                      <Badge variant={card.lane === 'backlog' ? 'outline' : 'default'}>
                        {card.lane === 'backlog' ? m.backlog : m.todo}
                      </Badge>
                      {card.question && <Badge variant="pending">{m.openQuestion}</Badge>}
                      {card.lane === 'backlog' && (
                        <Button
                          type="button"
                          size="s"
                          variant="outline"
                          className="bplan__edit"
                          onClick={() => onEdit(card.id)}
                        >
                          <PencilLineIcon aria-hidden="true" />
                          {m.edit}
                        </Button>
                      )}
                    </div>
                    <p className="bplan__cond-title">{m.planConditions}</p>
                    <AcceptanceList items={card.conditions} />
                  </li>
                ))}
            </ol>
          </Fragment>
        ))}
      </div>
    </Surface>
  );
}
