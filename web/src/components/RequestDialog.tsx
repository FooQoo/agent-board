import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { Epic } from '../types';
import { DialogFrame } from './DialogFrame';
import { AttachmentPanel } from './editor/AttachmentPanel';
import type { EditorAttachment } from './editor/attachmentTypes';
import { useAttachmentState } from './editor/useAttachmentState';
import { useMultipartRequest } from './editor/useMultipartRequest';
import { countChars, DESCRIPTION_LIMIT, normalizeNewlines } from './editor/limits';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import '../styles/modal.css';

export interface RequestInput {
  requestKind: 'simple';
  description: string;
  epicId: string | null;
  requestId: string;
  attachments: EditorAttachment[];
}

export function RequestDialog({
  epics,
  onClose,
  onSavingChange,
  onSubmit,
  onCreateManually,
}: {
  epics: readonly Epic[];
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (input: RequestInput) => Promise<void>;
  onCreateManually: () => void;
}) {
  const { t } = useTranslation();
  const [request, setRequest] = useState('');
  const [epicId, setEpicId] = useState('');
  const [saving, setSaving] = useState(false);
  const requestId = useMultipartRequest();
  const attachmentsState = useAttachmentState({ resolveStoredUrl: () => '' });
  const normalized = normalizeNewlines(request);
  // U3 derives the task title and wraps the original request in its own task section. Keep the
  // submitted description limited to the user's normalized text so the first line stays the title.
  const description = normalized;
  const valid = request.trim() !== '' && countChars(description) <= DESCRIPTION_LIMIT;
  const dirty = request !== '' || epicId !== '' || attachmentsState.attachments.length > 0;

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        requestKind: 'simple',
        description,
        epicId: epicId || null,
        requestId: requestId({
          description,
          epicId: epicId || null,
          attachments: attachmentsState.attachments.map((attachment) => attachment.id),
        }),
        attachments: attachmentsState.attachments,
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedEpic = epics.find((epic) => epic.id === epicId);

  return (
    <DialogFrame
      title={t('simpleTask.title')}
      submitLabel={t('simpleTask.submit')}
      onClose={onClose}
      onSavingChange={onSavingChange}
      validate={() =>
        !valid
          ? request.trim() === ''
            ? t('simpleTask.required')
            : t('simpleTask.tooLong', { max: DESCRIPTION_LIMIT })
          : null
      }
      save={submit}
      dirty={dirty}
      className="request-dialog"
      footerNote={<p className="modal__card request-dialog__note">{t('simpleTask.footerNote')}</p>}
      submitDisabled={!valid}
      secondaryAction={{ label: t('simpleTask.createManually'), onClick: onCreateManually }}
    >
      <div className="modal__field request-dialog__request">
        <Label htmlFor="request-content">{t('simpleTask.promptLabel')}</Label>
        <Textarea
          id="request-content"
          className="modal__textarea request-dialog__textarea"
          value={request}
          disabled={saving}
          onChange={(event) => setRequest(event.currentTarget.value)}
          placeholder={t('simpleTask.promptPlaceholder')}
          aria-invalid={!valid}
        />
      </div>
      <div className="modal__field">
        <Label id="request-epic-label">{t('simpleTask.epicLabel')}</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="request-dialog__epic-trigger"
              aria-labelledby="request-epic-label"
              disabled={saving}
            >
              <span>{selectedEpic?.name ?? t('simpleTask.noEpic')}</span>
              <ChevronDownIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="request-dialog__epic-menu" align="start">
            <DropdownMenuRadioGroup
              value={epicId || '__none'}
              onValueChange={(value) => setEpicId(value === '__none' ? '' : value)}
            >
              <DropdownMenuRadioItem value="__none">{t('simpleTask.noEpic')}</DropdownMenuRadioItem>
              {epics.map((epic) => (
                <DropdownMenuRadioItem key={epic.id} value={epic.id}>
                  {epic.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AttachmentPanel
        attachments={attachmentsState.attachments}
        onFiles={attachmentsState.addFiles}
        onRemove={attachmentsState.remove}
        notice={attachmentsState.error}
        disabled={saving}
        className="request-dialog__attachments"
      />
    </DialogFrame>
  );
}
