import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BotIcon, UserIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { Assignee } from '../types';
import { CardStatusBadge } from './DialogBadges';
import { DialogFrame } from './DialogFrame';

export interface CreateInput {
  title: string;
  description: string;
  assignee: Assignee;
}

export function CreateDialog({
  onClose,
  onSavingChange,
  onSubmit,
}: {
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: CreateInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState<Assignee>('ai');
  const titleId = useId();
  const descriptionId = useId();
  const assigneeId = useId();

  const validate = () => {
    const length = [...title.trim()].length;
    if (length === 0) return t('dialog.titleRequired');
    if (length > 100) return t('dialog.titleTooLong');
    return null;
  };

  return (
    <DialogFrame
      title={t('dialog.createTitle')}
      submitLabel={t('dialog.submitCreate')}
      onClose={onClose}
      onSavingChange={onSavingChange}
      validate={validate}
      save={() => onSubmit({ title: title.trim(), description, assignee })}
    >
      <div className="modal__field">
        <Label htmlFor={titleId}>{t('dialog.cardTitle')}</Label>
        <Input
          id={titleId}
          value={title}
          maxLength={100}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="modal__field">
        <Label htmlFor={descriptionId}>{t('detail.description')}</Label>
        <Textarea
          id={descriptionId}
          className="modal__textarea modal__textarea--short"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="modal__field">
        <Label id={assigneeId}>{t('dialog.assignee')}</Label>
        <RadioGroup
          className="segmented"
          aria-labelledby={assigneeId}
          value={assignee}
          onValueChange={(value) => setAssignee(value === 'human' ? 'human' : 'ai')}
        >
          {(['ai', 'human'] as const).map((value) => (
            <RadioGroupPrimitive.Item key={value} value={value} className="segmented__option">
              {value === 'ai' ? <BotIcon aria-hidden="true" /> : <UserIcon aria-hidden="true" />}
              {t(value === 'ai' ? 'dialog.assigneeAgent' : 'dialog.assigneeUser')}
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroup>
        <p className="modal__hint">{t('dialog.assigneeHint')}</p>
      </div>
      <div className="modal__destination">
        <span className="modal__caption">{t('dialog.createdIn')}</span>
        <CardStatusBadge status="todo" />
      </div>
    </DialogFrame>
  );
}
