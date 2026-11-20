import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/lightbox.css';

/** One picture of the viewer. `alt` is its accessible name. */
export interface ViewerImage {
  src: string;
  alt: string;
  referrerPolicy?: 'no-referrer';
}

/**
 * The enlarged pictures of one group: a row of full-width slides that snaps to one slide at a time.
 * The browser's own scrolling does the work: a sideways swipe moves between slides, and each slide
 * scrolls up and down by itself when its picture is taller than the viewer, so the two gestures
 * never compete. The left and right arrow keys step too. A single picture shows no position and
 * has nothing to swipe to.
 */
export function ImageViewer({
  images,
  index,
  onIndexChange,
}: {
  images: readonly ViewerImage[];
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const count = images.length;
  const scrollToIndex = useCallback((target: number, smooth: boolean) => {
    const element = track.current;
    if (!element || typeof element.scrollTo !== 'function') return;
    element.scrollTo({
      left: target * element.clientWidth,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);
  // Open at the tapped picture, before the first paint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the first position is applied here
  useLayoutEffect(() => {
    scrollToIndex(index, false);
    // Only the first position is applied here; later moves come from the person's own scrolling.
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = Math.min(
        count - 1,
        Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)),
      );
      if (target === index) return;
      event.preventDefault();
      onIndexChange(target);
      scrollToIndex(target, true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [count, index, onIndexChange, scrollToIndex]);
  const onScroll = () => {
    const element = track.current;
    if (!element || element.clientWidth === 0) return;
    const current = Math.round(element.scrollLeft / element.clientWidth);
    if (current !== index && current >= 0 && current < count) onIndexChange(current);
  };
  return (
    <div className="lightbox__zoom">
      <div className="lightbox__viewer" ref={track} onScroll={onScroll} data-viewer>
        {images.map((image, slide) => (
          <div
            key={`${slide}:${image.src}`}
            className="lightbox__slide"
            role="group"
            aria-roledescription="slide"
            aria-label={t('lightbox.imagePosition', { index: slide + 1, count })}
          >
            <img
              src={image.src}
              alt={image.alt}
              referrerPolicy={image.referrerPolicy}
              loading={Math.abs(slide - index) <= 1 ? 'eager' : 'lazy'}
              draggable={false}
            />
          </div>
        ))}
      </div>
      {count > 1 && (
        <span className="lightbox__position" aria-live="polite">
          {t('lightbox.imagePosition', { index: index + 1, count })}
        </span>
      )}
    </div>
  );
}
