import type { ReactNode } from 'react';
import { useNarrowViewport } from '@/shared/lib/viewport/useNarrowViewport';
import { useNotificationSettings } from '../useNotificationSettings';
import { NotificationDialogView } from './NotificationDialogView';

/**
 * The dialog wired to the board's own `/api/notification-settings`. Mount it only while it is
 * open: it reads the saved choices when it appears.
 */
export default function NotificationDialog({
  onClose,
  push,
}: {
  onClose: () => void;
  push?: ReactNode;
}) {
  const narrow = useNarrowViewport();
  const { state, change } = useNotificationSettings();
  return (
    <NotificationDialogView
      kind={narrow ? 'sheet' : 'dialog'}
      onClose={onClose}
      state={state}
      onChange={change}
      push={push}
    />
  );
}
