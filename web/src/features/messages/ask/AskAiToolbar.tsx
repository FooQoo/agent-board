import { ArrowUpIcon, ImageIcon, XIcon } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
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
}: {
  images: readonly EditorAttachment[];
  error: string;
  saving: boolean;
  canSend: boolean;
  canAddImages: boolean;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
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
        <ul className="ask-ai__thumbs" aria-label={t('editor.attachmentsLabel')}>
          {images.map((image) => (
            <li key={image.id} className="ask-ai__thumb">
              <img src={image.url} alt={image.name} />
              <Button
                type="button"
                variant="outline"
                size="s"
                iconOnly
                className="ask-ai__thumb-remove"
                aria-label={t('askAi.removeImage', { name: image.name })}
                disabled={saving}
                onClick={() => onRemove(image.id)}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="ask-ai__toolbar">
        {canAddImages ? (
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
        ) : (
          <span />
        )}
        <Button type="button" disabled={saving || !canSend} onClick={onSend} {...keepFocusOnPress}>
          <ArrowUpIcon aria-hidden="true" />
          {t('askAi.submit')}
        </Button>
      </div>
    </>
  );
}
