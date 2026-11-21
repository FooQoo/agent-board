import { useRef } from 'react';
import type { ViewerImage } from './viewerImage';
import { useImageZoom } from './useImageZoom';

/**
 * One slide of the viewer. Its picture zooms with a pinch (or a trackpad pinch), pans with one
 * finger while zoomed, and toggles with a double tap. It returns to 1x when the slide stops being
 * the one shown.
 */
export function ZoomSlide({
  image,
  label,
  eager,
  active,
}: {
  image: ViewerImage;
  label: string;
  eager: boolean;
  active: boolean;
}) {
  const slide = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const { zoom, handlers } = useImageZoom(slide, picture, active);
  const zoomed = zoom.scale > 1;
  return (
    <div
      ref={slide}
      className="lightbox__slide"
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      data-zoomed={zoomed ? '' : undefined}
      {...handlers}
    >
      <img
        ref={picture}
        src={image.src}
        alt={image.alt}
        referrerPolicy={image.referrerPolicy}
        loading={eager ? 'eager' : 'lazy'}
        draggable={false}
        data-zoom-scale={zoomed ? zoom.scale.toFixed(3) : undefined}
        style={
          zoomed
            ? { transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` }
            : undefined
        }
      />
    </div>
  );
}
