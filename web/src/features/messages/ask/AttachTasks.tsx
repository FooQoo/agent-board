import { HashIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { keepFocusOnPress } from '@/shared/ui/keepFocus';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Surface } from '../../../shared/ui/surface/Surface';
import { attachedTaskIds, withAttachedTasks } from './attachLine';
import type { PickerTask } from './pickerTasks';
import { TaskPickerConfirm, TaskPickerFields, useTaskPicker } from './TaskPicker';

/** The picker's body, mounted only while it is open so that every opening reads the text again. */
function PickerBody({
  kind,
  tasks,
  initial,
  onConfirm,
  onClose,
}: {
  kind: 'dialog' | 'sheet';
  tasks: readonly PickerTask[];
  initial: readonly number[];
  onConfirm: (ids: number[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const picker = useTaskPicker(tasks, initial);
  const confirm = <TaskPickerConfirm picker={picker} onConfirm={onConfirm} />;
  if (kind === 'sheet') {
    // A second sheet over the composer: both are Radix dialogs, so the composer's focus trap and its
    // outside-click handling pause while this one is on top and resume when it closes.
    return (
      <Surface
        kind="sheet"
        title={t('askAi.attachTitle')}
        closeLabel={t('dialog.close')}
        onClose={onClose}
        className="task-picker-sheet"
        footer={confirm}
      >
        <TaskPickerFields picker={picker} />
      </Surface>
    );
  }
  return (
    <>
      <p className="task-picker__title">{t('askAi.attachTitle')}</p>
      <TaskPickerFields picker={picker} />
      <div className="task-picker__foot">{confirm}</div>
    </>
  );
}

/**
 * The "Attach task" button of the Ask AI composer. On the board it opens a popover above the button,
 * on a phone a bottom sheet over the composer; both hold the same picker. The request text is the
 * only state: the picker reads the ids on its last line when it opens, and a confirm rewrites it.
 */
export function AttachTasks({
  kind,
  tasks,
  text,
  disabled,
  onChange,
}: {
  kind: 'dialog' | 'sheet';
  tasks: readonly PickerTask[];
  text: string;
  disabled?: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The popover is drawn inside the composer's own dialog: a portal to the page body would sit
  // outside the dialog's focus trap and its scroll lock, so the list could not be scrolled.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const attached = attachedTaskIds(text);
  const label =
    attached.length > 0 ? t('askAi.attachCount', { count: attached.length }) : t('askAi.attach');
  const openPicker = (next: boolean) => {
    if (next) setContainer(button.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
    setOpen(next);
  };
  // Whatever closed the picker, the keyboard continues from the button that opened it.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const body = (
    <PickerBody
      kind={kind}
      tasks={tasks}
      initial={attached}
      onConfirm={(ids) => {
        onChange(withAttachedTasks(text, ids));
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
    />
  );
  const trigger = (
    <Button
      ref={button}
      type="button"
      variant="ghost"
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      // A press must not blur the text field: on a touch screen that closes the keyboard and moves the
      // button before the tap's click arrives (see `keepFocusOnPress`).
      {...keepFocusOnPress}
      onClick={kind === 'sheet' ? () => openPicker(true) : undefined}
    >
      <HashIcon aria-hidden="true" />
      {label}
    </Button>
  );
  if (kind === 'sheet') {
    return (
      <>
        {trigger}
        {open && body}
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={openPicker}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-label={t('askAi.attachTitle')}
        className="task-picker task-picker--popover"
        container={container}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
}
