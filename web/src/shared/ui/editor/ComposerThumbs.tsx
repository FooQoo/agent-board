import { XIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageLightbox } from '../lightbox/ImageLightbox';
import type { EditorAttachment } from './attachmentTypes';
import './composer-thumbs.css';

export interface ComposerThumbsProps {
  attachments: readonly EditorAttachment[];
  /** Names the list of thumbnails. */
  label: string;
  /** Names the remove button of one picture. */
  removeLabel: (name: string) => string;
  disabled?: boolean;
  onRemove: (id: string) => void;
  className?: string;
}

/**
 * The pictures attached to a composer: a row of thumbnails that scrolls sideways. A tap on a
 * thumbnail opens the picture in the shared viewer; the remove button has its own finger-sized
 * tap area in the thumbnail's corner.
 */
export const ComposerThumbs: React.FC<ComposerThumbsProps> = ({
  attachments,
  label,
  removeLabel,
  disabled = false,
  onRemove,
  className = '',
}) => {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState<number | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  return (
    <>
      <ul className={`composer-thumbs ${className}`} aria-label={label}>
        {attachments.map((image, index) => (
          <li key={image.id} className="composer-thumb">
            <button
              type="button"
              className="composer-thumb__open"
              aria-label={t('editor.previewAttachment', { name: image.name })}
              onClick={(event) => {
                trigger.current = event.currentTarget;
                setZoom(index);
              }}
            >
              <img src={image.url} alt="" />
            </button>
            <button
              type="button"
              className="composer-thumb__remove"
              aria-label={removeLabel(image.name)}
              disabled={disabled}
              onClick={() => onRemove(image.id)}
            >
              <XIcon aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {zoom !== null && (
        <ImageLightbox
          images={attachments.map((item) => ({ src: item.url, alt: item.name }))}
          startIndex={zoom}
          label={(index) => attachments[index]?.name ?? ''}
          onClose={() => setZoom(null)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
};
