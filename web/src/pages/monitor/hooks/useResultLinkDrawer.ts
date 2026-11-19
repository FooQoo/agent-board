import { useEffect, useRef } from 'react';
import { linkKey, type ResultLinkTarget } from '../../../features/tasks/results/resultLink';
import type { Message } from '../../../shared/data/api/contracts';
import type { MonitorDetailTab, MonitorTask } from '../contracts';

/**
 * A notification link opens its task's drawer on the results or history tab once the list has the
 * task, and only once per link, so closing the drawer is not undone. A question link opens the
 * message list on that question once the messages are read, or the card's drawer when the question
 * is no longer listed (answered, withdrawn).
 */
export function useResultLinkDrawer(
  tasks: readonly MonitorTask[],
  resultLink: ResultLinkTarget | null,
  show: (item: MonitorTask, tab: MonitorDetailTab) => void,
  question?: {
    messages: readonly Message[] | null | undefined;
    open: (messageId: string) => void;
  },
) {
  const opened = useRef<string | null>(null);
  const linked =
    resultLink === null ? undefined : tasks.find((item) => item.task.id === resultLink.taskId);
  const messages = question?.messages;
  const openQuestion = question?.open;
  useEffect(() => {
    if (resultLink === null) return;
    const key = `${linked?.projectId ?? ''}:${linkKey(resultLink)}`;
    if (opened.current === key) return;
    if (resultLink.tab === 'question') {
      const id = resultLink.questionId ?? '';
      if (openQuestion && messages) {
        if (messages.some((message) => message.id === id)) {
          opened.current = key;
          openQuestion(id);
          return;
        }
        if (linked !== undefined) {
          opened.current = key;
          show(linked, 'description');
        }
        return;
      }
      // Without a message list the card is all there is to open.
      if (openQuestion === undefined && linked !== undefined) {
        opened.current = key;
        show(linked, 'description');
      }
      return;
    }
    if (linked === undefined) return;
    opened.current = key;
    show(linked, resultLink.tab);
  }, [resultLink, linked, show, messages, openQuestion]);
}
