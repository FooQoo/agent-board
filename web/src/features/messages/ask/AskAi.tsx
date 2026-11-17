import type { ProjectId } from '../../../shared/api/contracts';
import { AskAiDialog } from './AskAiDialog';
import { sendMessageRequest } from './sendRequest';

export interface AskAiProps {
  projectId: ProjectId;
  /** The dialog is done: sent, or cancelled. */
  onClose: () => void;
  /** The request was saved. The Summary refreshes through the live update. */
  onSent?: () => void;
  /** A draft the text starts with. */
  initialText?: string;
}

/** "Ask AI" that sends its own request. A modal on the board (`kind="dialog"`) or a sheet. */
export function AskAi({
  kind = 'dialog',
  projectId,
  onClose,
  onSent,
  initialText,
}: AskAiProps & { kind?: 'dialog' | 'sheet' }) {
  return (
    <AskAiDialog
      kind={kind}
      initialText={initialText}
      onClose={onClose}
      onSubmit={async (input) => {
        await sendMessageRequest(projectId, input);
        onSent?.();
        onClose();
      }}
    />
  );
}

/**
 * "Ask AI" as a bottom sheet, for the phone. The messages band opens it from its "Ask AI" button:
 * `{asking && <AskAiSheet projectId={id} onClose={() => setAsking(false)} />}`.
 */
export function AskAiSheet(props: AskAiProps) {
  return <AskAi kind="sheet" {...props} />;
}
