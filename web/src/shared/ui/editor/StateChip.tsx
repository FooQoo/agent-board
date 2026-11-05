import { BotIcon, FilePenIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './preview-states.css';

export interface StateChipProps {
  /** `draft`: the dialog holds the draft lock. `running`: an agent is working on the card. */
  kind: 'draft' | 'running';
}

/** The state next to the title of the editor dialog; pass it as the `badge` of `EditorShell`. */
export function StateChip({ kind }: StateChipProps) {
  const { t } = useTranslation();
  const Icon = kind === 'draft' ? FilePenIcon : BotIcon;
  return (
    <span className="state-chip" data-kind={kind}>
      <Icon aria-hidden="true" />
      {kind === 'draft' ? t('editor.draft') : t('editor.running')}
    </span>
  );
}
