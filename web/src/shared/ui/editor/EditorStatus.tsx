import { CircleAlertIcon, EyeIcon, LockIcon } from 'lucide-react';
import './preview-states.css';

/** What a footer line says: an error, the lock the draft holds, why it only reads, or a plain note. */
export type EditorStatusTone = 'error' | 'lock' | 'reason' | 'info';

export interface EditorStatusLine {
  tone: EditorStatusTone;
  text: string;
}

export interface EditorStatusProps {
  lines: readonly EditorStatusLine[];
}

const ICONS = {
  error: CircleAlertIcon,
  lock: LockIcon,
  reason: EyeIcon,
  info: EyeIcon,
} as const;

/**
 * The lines at the left of the editor footer, one per reason, each with its icon. It fits the
 * `status` slot of `EditorShell`; one line keeps the footer height the shell already has.
 */
export function EditorStatus({ lines }: EditorStatusProps) {
  return (
    <span className="editor-status">
      {lines.map((line) => {
        const Icon = ICONS[line.tone];
        return (
          <span
            key={`${line.tone}:${line.text}`}
            className="editor-status__line"
            data-tone={line.tone}
          >
            <Icon aria-hidden="true" />
            <span>{line.text}</span>
          </span>
        );
      })}
    </span>
  );
}
