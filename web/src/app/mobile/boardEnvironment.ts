import type { ProjectId } from '../../shared/api/contracts';
import { csrfHeaders, projectPath, readToken } from '../../shared/api/http';
import type { MonitorEnvironment } from '../../pages/monitor/MonitorProject';
import { answerQuestions, setAcceptance } from '../../features/tasks/api/edit';
import { fetchQuestion } from '../../features/tasks/api/read';

const taskUrl = (projectId: ProjectId, taskId: number) =>
  `${projectPath(projectId)}/tasks/${taskId}`;

/**
 * The phone screen as the board app gives it: every read and write goes to the board's own routes
 * (`/api/...`) with the board's page token, the same ones the PC board uses. The sample-data mode
 * and the demo have no server to keep the language and theme, so those stay in the browser.
 */
export function boardEnvironment(): MonitorEnvironment {
  const serverless = import.meta.env.MODE === 'mock' || import.meta.env.MODE === 'demo';
  return {
    readResolvers: {
      attachmentUrl: (projectId, taskId, attachmentId) =>
        `${taskUrl(projectId, taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
      epicAttachmentUrl: (projectId, epicId, attachmentId) =>
        `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
      setAcceptance: (projectId, taskId, conditionId, done) =>
        setAcceptance(projectId, taskId, conditionId, done),
    },
    preferences: serverless
      ? undefined
      : { url: '/api/preferences', token: readToken, headers: csrfHeaders },
    readQuestion: fetchQuestion,
    writeAnswers: answerQuestions,
  };
}
