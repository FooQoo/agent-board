import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTouchScreen } from '../../../shared/lib/viewport/isTouchScreen';
import { Surface } from '../../../shared/ui/surface/Surface';
import { Textarea } from '../../../shared/ui/textarea';
import { DiscardConfirm } from '../../../shared/ui/editor/DiscardConfirm';
import { attachmentNoticeText } from '../../../shared/ui/editor/AttachmentPanel';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';
import { useAttachmentState } from '../../../shared/ui/editor/useAttachmentState';
import { AskAiToolbar } from './AskAiToolbar';
import './ask-ai.css';
import { REQUEST_LIMIT } from './sendRequest';

/** What the dialog hands over: the request text and the images the person added. */
export interface AskAiInput {
  text: string;
  attachments: EditorAttachment[];
}

/** The demo build keeps nothing it could save pictures to. */
const PICTURES_ALLOWED = import.meta.env.MODE !== 'demo';

/**
 * The "Ask AI" composer, laid out like a chat input: only the title on top, a plain text field that
 * fills the height, and a toolbar at the bottom with "Image" and "Send request" and the attached
 * thumbnails just above it. It has no epic selector, because a request is
 * linked to neither tasks nor epics. It is a modal on the board and a bottom sheet on a phone.
 */
export function AskAiDialog({
  kind = 'dialog',
  onClose,
  onSubmit,
  onSavingChange,
  initialText = '',
}: {
  /** A modal on the board, a bottom sheet on a phone. */
  kind?: 'dialog' | 'sheet';
  onClose: () => void;
  /** Sends the request; the dialog closes when it resolves. A rejection keeps it open and shows its message. */
  onSubmit: (input: AskAiInput) => Promise<void>;
  /** Reports that a send started (`true`) or failed and the input was kept (`false`). */
  onSavingChange?: (saving: boolean) => void;
  initialText?: string;
}) {
  const { t } = useTranslation();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const images = useAttachmentState({ resolveStoredUrl: () => '' });
  const addImages = (files: File[]) => {
    if (!PICTURES_ALLOWED) return;
    const pictures = files.filter((file) => file.type.startsWith('image/'));
    if (pictures.length > 0) images.addFiles(pictures);
  };
  // On a screen with a keyboard the text field is ready to type in; a touch screen would raise its
  // keyboard over the dialog.
  useEffect(() => {
    if (isTouchScreen()) return;
    const frame = requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const validate = (): string | null => {
    if (text.trim() === '') return t('askAi.required');
    if ([...text.trim()].length > REQUEST_LIMIT) return t('askAi.tooLong', { max: REQUEST_LIMIT });
    return null;
  };
  const submit = async () => {
    if (saving) return;
    const invalid = validate();
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setError('');
    setSaving(true);
    onSavingChange?.(true);
    try {
      await onSubmit({ text: text.trim(), attachments: images.attachments });
      onClose();
    } catch (cause) {
      // Keep the server's reason visible so a refused request can be fixed; a network failure gets
      // the localized message. The text and the images stay.
      onSavingChange?.(false);
      setError(cause instanceof Error && cause.message ? cause.message : t('askAi.sendFailed'));
    } finally {
      setSaving(false);
    }
  };
  const dirty = text.trim() !== '' || images.attachments.length > 0;
  // Closing with something entered asks first; an empty composer closes at once.
  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const notice = images.error ? attachmentNoticeText(images.error, t) : '';
  return (
    <>
      <Surface
        kind={kind}
        title={t('askAi.title')}
        closeLabel={t('dialog.close')}
        onClose={requestClose}
        className={`ask-ai ask-ai--${kind}`}
        footer={
          <AskAiToolbar
            images={images.attachments}
            error={error || notice}
            saving={saving}
            canSend={dirty}
            canAddImages={PICTURES_ALLOWED}
            onFiles={addImages}
            onRemove={images.remove}
            onSend={() => void submit()}
          />
        }
      >
        <div
          role="region"
          aria-label={t('askAi.title')}
          className="ask-ai__body"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => {
            if (event.dataTransfer.files.length === 0) return;
            event.preventDefault();
            addImages(Array.from(event.dataTransfer.files));
          }}
        >
          <Textarea
            ref={field}
            className="ask-ai__input"
            aria-label={t('askAi.prompt')}
            placeholder={t('askAi.prompt')}
            value={text}
            readOnly={saving}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (!files.some((file) => file.type.startsWith('image/'))) return;
              event.preventDefault();
              addImages(files);
            }}
          />
        </div>
      </Surface>
      <DiscardConfirm
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        onKeep={() => setConfirmDiscard(false)}
        onDiscard={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
