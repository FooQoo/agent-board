import type { PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DetailWidth } from '../hooks/useDetailWidth';

export type ResizeHandleProps = Pick<DetailWidth, 'startDrag' | 'moveDrag' | 'endDrag'>;

export function ResizeHandle({ startDrag, moveDrag, endDrag }: ResizeHandleProps) {
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
      aria-label={t('detail.resize')}
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
