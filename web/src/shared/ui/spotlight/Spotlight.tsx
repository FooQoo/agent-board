import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/shared/lib/classnames/utils';
import './spotlight.css';

/** A region of the stage in CSS pixels, measured from the stage's top-left corner. */
export interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  /** Omit to let the frame follow its content, up to `maxHeight`. */
  height?: number;
  /** The tallest the frame may grow; a taller region scrolls inside it. */
  maxHeight?: number;
}

/**
 * Frames a region of the stage and dims everything outside it. The dimming is the region's own
 * box-shadow, so no layer has to sit above the region, and its children stay in the same
 * stacking context as the rest of the stage.
 */
export function Spotlight({
  target,
  className,
  children,
}: {
  target: SpotlightRect;
  className?: string;
  children?: ReactNode;
}) {
  const style: CSSProperties = {
    left: target.x,
    top: target.y,
    width: target.width,
    height: target.height,
    maxHeight: target.maxHeight,
  };
  return (
    <div data-slot="spotlight" className={cn('spotlight', className)} style={style}>
      {children}
    </div>
  );
}
