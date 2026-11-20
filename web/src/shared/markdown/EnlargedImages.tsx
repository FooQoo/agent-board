import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageLightbox } from '../ui/lightbox/ImageLightbox';
import type { ViewerImage } from '../ui/lightbox/ImageViewer';
import { imageUrlOf } from './model';
import { ImageGroupContext, RelativeImageContext, ResolverContext } from './renderScope';
import type { WrittenImage } from './collectImages';

/**
 * The pictures to swipe across, and where the tapped one is among them. The pictures are the
 * images of the same text that can be shown; one that has no URL is left out. Without a number
 * (an image outside a parsed text) or when the tapped one is not found, it is shown alone.
 */
export function enlargedGroup(
  written: readonly WrittenImage[],
  order: number | undefined,
  own: ViewerImage,
  resolve: (src: string) => string | null,
): { images: ViewerImage[]; startIndex: number } {
  const images: ViewerImage[] = [];
  let startIndex = -1;
  written.forEach((image, position) => {
    const url = resolve(image.src);
    if (url === null) return;
    if (position === order) startIndex = images.length;
    images.push({ src: url, alt: image.alt, referrerPolicy: 'no-referrer' });
  });
  return startIndex < 0 ? { images: [own], startIndex: 0 } : { images, startIndex };
}

/** The enlarged view of one Markdown image, swipeable across the images of the same text. */
export function EnlargedImages({
  order,
  own,
  onClose,
}: {
  order: number | undefined;
  own: ViewerImage;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const resolve = useContext(ResolverContext);
  const resolveRelative = useContext(RelativeImageContext);
  const group = useContext(ImageGroupContext);
  const { images, startIndex } = enlargedGroup(group?.current ?? [], order, own, (src) =>
    imageUrlOf(src, resolve, resolveRelative),
  );
  return (
    <ImageLightbox
      images={images}
      startIndex={startIndex}
      label={(index) => images[index]?.alt || t('markdown.image')}
      onClose={onClose}
    />
  );
}
