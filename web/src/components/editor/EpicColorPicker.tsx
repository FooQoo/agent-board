import { useEffect, useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  const r = channel(1);
  const g = channel(3);
  const b = channel(5);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const hue =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${rgb
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** The design's saturation/value map, hue bar and editable HEX value. Changes preview until Save. */
export function EpicColorPicker({
  color,
  disabled,
  onChange,
}: {
  color: string;
  disabled: boolean;
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation();
  const hexId = useId();
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hex, setHex] = useState(color);
  useEffect(() => {
    setHex(color);
    // Retain hue and saturation when the map reaches black or white.
    setHsv((current) => (hsvToHex(current) === color.toUpperCase() ? current : hexToHsv(color)));
  }, [color]);

  const choose = (next: Hsv) => {
    if (disabled) return;
    setHsv(next);
    onChange(hsvToHex(next));
  };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    choose({
      ...hsv,
      s: clamp((event.clientX - rect.left) / rect.width),
      v: 1 - clamp((event.clientY - rect.top) / rect.height),
    });
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const next = { ...hsv };
    if (event.key === 'ArrowLeft') next.s = clamp(next.s - step);
    else if (event.key === 'ArrowRight') next.s = clamp(next.s + step);
    else if (event.key === 'ArrowUp') next.v = clamp(next.v + step);
    else if (event.key === 'ArrowDown') next.v = clamp(next.v - step);
    else return;
    event.preventDefault();
    choose(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="epic-label-row__swatch"
          aria-label={t('epic.colorPick')}
          disabled={disabled}
          style={{ background: color }}
        />
      </PopoverTrigger>
      <PopoverContent className="epic-color" aria-label={t('epic.colorPick')} align="end">
        <p className="epic-color__title">{t('epic.colorPick')}</p>
        <div
          className="epic-color__map"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label={t('epic.colorMap')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.s * 100)}
          aria-valuetext={t('epic.colorMapValue', {
            saturation: Math.round(hsv.s * 100),
            brightness: Math.round(hsv.v * 100),
          })}
          style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
          onKeyDown={key}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
            point(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              point(event);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        >
          <span
            className="epic-color__point"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: color }}
          />
        </div>
        <input
          type="range"
          disabled={disabled}
          className="epic-color__hue"
          min={0}
          max={360}
          value={hsv.h}
          aria-label={t('epic.colorHue')}
          onChange={(event) => choose({ ...hsv, h: Number(event.target.value) })}
        />
        <div className="epic-color__hex">
          <Label htmlFor={hexId}>HEX</Label>
          <Input
            id={hexId}
            disabled={disabled}
            value={hex}
            maxLength={7}
            spellCheck={false}
            aria-invalid={!/^#[0-9a-f]{6}$/i.test(hex)}
            onChange={(event) => {
              const value = event.target.value.toUpperCase();
              setHex(value);
              if (/^#[0-9A-F]{6}$/.test(value)) onChange(value);
            }}
            onBlur={() => setHex(color)}
          />
        </div>
        <p className="epic-color__hint">{t('epic.colorPreview')}</p>
      </PopoverContent>
    </Popover>
  );
}
