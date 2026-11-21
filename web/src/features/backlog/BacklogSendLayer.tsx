import { TransientNotice } from '../../shared/ui/transient-notice/TransientNotice';
import { SendConfirm } from './SendConfirm';
import type { BacklogMove } from './useBacklogMove';
import type { BacklogSend } from './useBacklogSend';

/** The notice of a failed send or move and the confirmation of its warning, for a screen that runs the send itself. */
export function BacklogSendLayer({
  send,
  kind,
}: {
  send: BacklogSend | BacklogMove;
  kind: 'dialog' | 'sheet';
}) {
  return (
    <>
      <TransientNotice message={send.notice} onDismiss={send.dismissNotice} />
      {send.confirming && (
        <SendConfirm
          kind={kind}
          to={send.confirming.to}
          count={send.confirming.ids.length}
          warned={send.confirming.warned}
          busy={send.busy}
          onConfirm={send.confirm}
          onCancel={send.cancel}
        />
      )}
    </>
  );
}
