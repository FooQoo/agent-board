import type { PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DetailWidth } from '../../lib/detail-width/useDetailWidth';

export type ResizeHandleProps = Pick<DetailWidth, 'startDrag' | 'moveDrag' | 'endDrag'> & {
  /** The accessible name; the task details unless the handle resizes something else. */
  label?: string;
};

export function ResizeHandle({ startDrag, moveDrag, endDrag, label }: ResizeHandleProps) {
  const { t } = useTranslation();

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    startDrag(event.clientX);
  };

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label ?? t('detail.resize')}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => moveDrag(event.clientX)}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="resize-handle__grip" aria-hidden="true" />
      <span className="resize-handle__grip" aria-hidden="true" />
      <span className="resize-handle__grip" aria-hidden="true" />
    </div>
  );
}
