import { useCallback, useEffect, useState } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import { isProjectId } from './projectSession';

export interface AnswerTarget {
  projectId: ProjectId;
  taskId: number;
}

/**
 * Which card's answer dialog is open. The dialog belongs to the project it was opened in: another
 * project closes it.
 */
export function useAnswerTarget(activeId: string | null) {
  const [opened, setOpened] = useState<AnswerTarget | null>(null);
  useEffect(() => {
    if (opened !== null && opened.projectId !== activeId) setOpened(null);
  }, [opened, activeId]);
  const openAnswer = useCallback(
    (taskId: number) => {
      if (isProjectId(activeId)) setOpened({ projectId: activeId, taskId });
    },
    [activeId],
  );
  const closeAnswer = useCallback(() => setOpened(null), []);
  return {
    answerTarget: opened?.projectId === activeId ? opened : null,
    openAnswer,
    closeAnswer,
  };
}
