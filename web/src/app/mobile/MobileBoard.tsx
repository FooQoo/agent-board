import { useMemo } from 'react';
import { BoardMessage } from '../../pages/board/ui/BoardMessage';
import { MonitorScreen } from '../../pages/monitor/MonitorProject';
import type { BuildReloadHook } from '../../pages/monitor/MonitorProject';
import type { MonitorHeaderProps } from '../../pages/monitor/contracts';
import { ProjectSwitcher } from '../../features/projects/switcher/ProjectSwitcher';
import { Header } from '../../shared/ui/app-header/Header';
import type { PhoneGuideLink } from '../../features/onboarding/model/phoneGuideLink';
import { isProjectId } from '../model/projectSession';
import type { AppControllerModel, AppWorkspaceActions } from '../contracts';
import { boardEnvironment } from './boardEnvironment';
import '../../shared/styles/modal.css';
import '../../features/tasks/answer/decision-answer.css';
import '../../pages/monitor/monitor-screen.css';

// The board reloads for a new build itself (`useAppController`), holding for what this screen holds.
const reloadsElsewhere: BuildReloadHook = () => undefined;
const stays = () => undefined;

/**
 * The board below 768px: the phone screen of the active project, drawn from the board's own data
 * layer and writing through the board's routes. The project, the held answers and the connection
 * come from the same controller as the PC board, so a change of width keeps them.
 */
export default function MobileBoard({
  model,
  actions,
  guideLink,
}: {
  model: AppControllerModel;
  actions: AppWorkspaceActions;
  /** The first-run guide's link to this screen. */
  guideLink?: PhoneGuideLink;
}) {
  const environment = useMemo(boardEnvironment, []);
  const { projects, session, activeId, known } = model;
  const header: MonitorHeaderProps = {
    projects:
      projects.projects.length > 0 || model.view === 'no-projects' ? projects.projects : null,
    activeProjectId: known ? activeId : null,
    switchDisabled: session.operation !== null,
    projectSwitcher: (
      <ProjectSwitcher
        projects={projects.projects}
        activeProjectId={known ? activeId : null}
        disabled={session.operation !== null || session.answerLeases.length > 0}
        onSelect={actions.onSelectProject}
      />
    ),
  };
  if (!known || !isProjectId(activeId))
    return (
      <main className="monitor-shell">
        <Header {...header} settingsSize="l" />
        {model.message !== null && <BoardMessage kind={model.message} onRetry={model.retry} />}
      </main>
    );
  return (
    <MonitorScreen
      key={activeId}
      {...environment}
      projectId={activeId}
      useBuildReload={reloadsElsewhere}
      build={null}
      stream={model.streamDown ? 'disconnected' : 'connected'}
      onNotFound={stays}
      header={header}
      guideLink={guideLink}
    />
  );
}
