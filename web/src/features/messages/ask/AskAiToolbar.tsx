import { ImageIcon, SendIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { ComposerThumbs } from '@/shared/ui/editor/ComposerThumbs';
import { keepFocusOnPress } from '@/shared/ui/keepFocus';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';

/** The footer of the Ask AI composer: the error line, the attached thumbnails, and the toolbar. */
export function AskAiToolbar({
  images,
  error,
  saving,
  canSend,
  canAddImages,
  onFiles,
  onRemove,
  onSend,
  attach,
}: {
  images: readonly EditorAttachment[];
  error: string;
  saving: boolean;
  canSend: boolean;
  canAddImages: boolean;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
  /** The "Attach task" button, drawn right of the image button. */
  attach?: ReactNode;
}) {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      {error && (
        <p className="ask-ai__error" role="alert">
          {error}
        </p>
      )}
      {images.length > 0 && (
        <ComposerThumbs
          attachments={images}
          label={t('editor.attachmentsLabel')}
          removeLabel={(name) => t('askAi.removeImage', { name })}
          disabled={saving}
          onRemove={onRemove}
        />
      )}
      <div className="ask-ai__toolbar">
        <div className="ask-ai__tools">
          {canAddImages && (
            <>
              <input
                ref={picker}
                className="ask-ai__picker"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  onFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = '';
                }}
              />
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => picker.current?.click()}
              >
                <ImageIcon aria-hidden="true" />
                {t('askAi.image')}
              </Button>
            </>
          )}
          {attach}
        </div>
        <Button type="button" disabled={saving || !canSend} onClick={onSend} {...keepFocusOnPress}>
          <SendIcon aria-hidden="true" />
          {t('askAi.submit')}
        </Button>
      </div>
    </>
  );
}
