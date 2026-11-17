import { ImagePlusIcon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';
import { DialogFrame } from '../../shared/ui/dialog-frame/DialogFrame';
import './exchanges-mock.css';
import { useMockText } from './text';

/**
 * The "Ask AI" dialog: one Markdown text and images. It has no epic selector and no manual
 * creation, because a request is linked to neither tasks nor epics.
 */
export function AskAiDialog({
  onClose,
  initialText = '',
  initialImages = 0,
}: {
  onClose: () => void;
  initialText?: string;
  initialImages?: number;
}) {
  const m = useMockText();
  const fieldId = useId();
  const [text, setText] = useState(initialText);
  const [images, setImages] = useState(initialImages);
  return (
    <DialogFrame
      title={m.askTitle}
      submitLabel={m.askSubmit}
      onClose={onClose}
      dirty={text.trim() !== ''}
      validate={() => (text.trim() === '' ? m.askRequired : null)}
      save={async () => {}}
      footerNote={<p className="xask__note">{m.askNote}</p>}
      scrollBody
      className="xask"
    >
      <div className="xask__field">
        <Label htmlFor={fieldId}>{m.askPrompt}</Label>
        <Textarea
          id={fieldId}
          className="xask__text"
          value={text}
          placeholder={m.askPlaceholder}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="xask__hint">{m.askMarkdownHint}</p>
      </div>
      <div className="xask__images">
        {Array.from({ length: images }, (_, index) => (
          <span key={index} className="xask__thumb">
            <img src="/sample-attachment.png" alt="" />
            <button
              type="button"
              aria-label={m.close}
              onClick={() => setImages((current) => current - 1)}
            >
              <XIcon className="xask__remove-icon" aria-hidden="true" />
            </button>
          </span>
        ))}
        <button type="button" className="xask__add" onClick={() => setImages((n) => n + 1)}>
          <ImagePlusIcon aria-hidden="true" />
          {m.askAddImage}
        </button>
      </div>
    </DialogFrame>
  );
}
