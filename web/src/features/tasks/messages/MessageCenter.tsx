import type { ProjectId } from '@/shared/api/contracts';
import type { Message } from '@/shared/data/api/contracts';
import { MessageBand } from './MessageBand';
import { MessagesSurface, type MessagesSurfaceProps } from './MessagesSurface';
import type { MessagesApi } from './model/messages';
import type { MessagesPanelController } from './useMessagesPanel';

export interface MessageCenterProps {
  projectId: ProjectId;
  /** The open messages of the project, oldest first. */
  messages: readonly Message[];
  /** `board`: the PC band and a modal. `phone`: the monitor's band and a bottom sheet. */
  variant: 'board' | 'phone';
  panel: MessagesPanelController;
  api: MessagesApi;
  /** An answer or a withdrawal was saved; the screen reads the project again at once. */
  onChanged: () => void;
  /** The phone band's "Ask AI" button; the band shows no such button without it. */
  onAsk?: () => void;
  /** Pulling the phone list down from its top reads the messages again. */
  onRefresh?: () => void;
  refreshing?: boolean;
  previewPull?: MessagesSurfaceProps['previewPull'];
  resolveAttachment?: (message: Message, attachmentId: string) => string | null;
}

/** The band of messages and the list it opens, which is drawn above the screen when it is open. */
export function MessageCenter({
  projectId,
  messages,
  variant,
  panel,
  api,
  onChanged,
  onAsk,
  onRefresh,
  refreshing,
  previewPull,
  resolveAttachment,
}: MessageCenterProps) {
  return (
    <>
      <MessageBand
        messages={messages}
        variant={variant}
        onOpen={(tab) => panel.open({ tab })}
        onAsk={onAsk}
      />
      {panel.target !== null && (
        <MessagesSurface
          projectId={projectId}
          messages={messages}
          kind={variant === 'phone' ? 'sheet' : 'dialog'}
          target={panel.target}
          api={api}
          onChanged={onChanged}
          onClose={panel.close}
          onLeaveForResult={panel.leaveForResult}
          onRefresh={onRefresh}
          refreshing={refreshing}
          previewPull={previewPull}
          resolveAttachment={resolveAttachment}
        />
      )}
    </>
  );
}
