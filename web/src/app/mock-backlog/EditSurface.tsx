import { PencilLineIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { AcceptanceEditor } from '../../features/tasks/acceptance/AcceptanceEditor';
import { Button } from '@/shared/ui/button';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { Input } from '@/shared/ui/input';
import type { AcceptanceItem } from '../../shared/api/contracts';
import type { MockCard } from './data';
import { Surface } from './Surface';
import { useMockText } from './text';
import './backlog-mock.css';

/**
 * Edits the plan text and the wording of the acceptance conditions of a Backlog card. The edit state
 * ("draft: human") is shown at the top. The achievement checkboxes of the product's editor are hidden
 * here, so a wording change cannot be mistaken for ticking a condition (see backlog-mock.css).
 */
export function EditSurface({
  kind,
  card,
  onClose,
  onSave,
}: {
  kind: 'dialog' | 'sheet';
  card: MockCard;
  onClose: () => void;
  onSave: (change: { title: string; body: string; conditions: AcceptanceItem[] }) => void;
}) {
  const m = useMockText();
  const titleId = useId();
  const bodyId = useId();
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const [conditions, setConditions] = useState<AcceptanceItem[]>(card.conditions);
  const empty = conditions.some((item) => item.text.trim() === '');
  return (
    <Surface
      kind={kind}
      title={m.editTitle(card.id)}
      identity={`#${card.id}`}
      onClose={onClose}
      className="bedit"
      footer={
        <DialogActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {m.cancel}
          </Button>
          <Button
            type="button"
            disabled={title.trim() === '' || empty}
            onClick={() => onSave({ title, body, conditions })}
          >
            {m.save}
          </Button>
        </DialogActions>
      }
    >
      <div className="bedit__body">
        <p className="bedit__state" role="status">
          <PencilLineIcon aria-hidden="true" />
          <span>
            <strong>{m.editing}</strong> {m.editingNote}
          </span>
        </p>
        <div className="bedit__field">
          <label className="bedit__label" htmlFor={titleId}>
            {m.editName}
          </label>
          <Input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="bedit__field">
          <label className="bedit__label" htmlFor={bodyId}>
            {m.editBody}
          </label>
          <textarea
            id={bodyId}
            className="bedit__textarea"
            value={body}
            rows={8}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
        <section className="bedit__field">
          <span className="bedit__label">{m.editConditions}</span>
          <p className="bedit__hint">{m.editConditionsNote}</p>
          <AcceptanceEditor items={conditions} onChange={setConditions} embedded />
        </section>
      </div>
    </Surface>
  );
}
