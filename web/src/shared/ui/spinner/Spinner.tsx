import { LoaderCircleIcon } from 'lucide-react';
import './Spinner.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  /** What is in progress. It is the accessible name; it is not drawn. */
  label: string;
  size?: SpinnerSize;
  className?: string;
}

/**
 * Only the turning mark, for a place that already announces its own status text (a footer line, a
 * pull indicator). It takes the color of the text around it.
 */
export function SpinnerIcon({
  size = 'sm',
  className,
}: {
  size?: SpinnerSize;
  className?: string;
}) {
  return (
    <LoaderCircleIcon
      className={['spinner-ui__icon', `spinner-ui--${size}`, className].filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  );
}

/**
 * The progress mark for anything that is loading or updating. It turns in the current text color,
 * stands still under reduced motion, and announces `label` as its accessible name.
 */
export function Spinner({ label, size = 'md', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={['spinner-ui', `spinner-ui--${size}`, className].filter(Boolean).join(' ')}
    >
      <LoaderCircleIcon className="spinner-ui__icon" aria-hidden="true" />
    </span>
  );
}
