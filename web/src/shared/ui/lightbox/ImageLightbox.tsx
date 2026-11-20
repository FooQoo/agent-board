import { useState } from 'react';
import { ImageViewer, type ViewerImage } from './ImageViewer';
import { Lightbox } from './Lightbox';

/**
 * The enlarged view of a group of pictures: the lightbox frame around the swipe viewer, opened at
 * `startIndex`. `label` names the dialog, for the picture shown now. It is mounted only while it is
 * open, so `onClose` is the only way it goes away.
 */
export function ImageLightbox({
  images,
  startIndex,
  label,
  onClose,
  onCloseAutoFocus,
}: {
  images: readonly ViewerImage[];
  startIndex: number;
  label: (index: number) => string;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [index, setIndex] = useState(startIndex);
  return (
    <Lightbox label={label(index)} onClose={onClose} onCloseAutoFocus={onCloseAutoFocus}>
      <ImageViewer images={images} index={index} onIndexChange={setIndex} />
    </Lightbox>
  );
}
