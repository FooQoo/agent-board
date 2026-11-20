import { useTranslation } from 'react-i18next';
import { Surface } from '@/shared/ui/surface/Surface';
import { useNarrowViewport } from '@/shared/lib/viewport/useNarrowViewport';
import { useResidentController } from '../useResidentController';
import { useSessionLog } from '../useSessionLog';
import { ResidentView } from './ResidentView';
import './resident.css';

/**
 * The dialog wired to the local API. Mount it only while it is open; it reads the sessions every
 * two seconds for as long as it is mounted.
 */
export default function ResidentDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const narrow = useNarrowViewport();
  const kind = narrow ? 'sheet' : 'dialog';
  const controller = useResidentController(projectId);
  const { snapshot, choice, models } = controller;
  // The log of the tool that runs (or ran last), else of the chosen one; it follows the dialog's life.
  const log = useSessionLog(projectId, snapshot?.health.tool ?? choice?.tool ?? 'claude-code');
  if (!snapshot || !choice) {
    return (
      <Surface
        kind={kind}
        title={t('resident.title')}
        closeLabel={t('dialog.close')}
        onClose={onClose}
        className="resident-surface"
      >
        <p className="resident-intro" role="status">
          {controller.failed ? t('resident.loadFailed') : t('status.boardLoading')}
        </p>
      </Surface>
    );
  }
  return (
    <ResidentView
      kind={kind}
      onClose={onClose}
      snapshot={snapshot}
      log={log}
      projectId={projectId}
      choice={choice}
      // A list that could not be read (or a missing CLI) leaves only the default model.
      models={models && { options: models.problem ? [] : models.options, reason: models.reason }}
      pending={controller.pending}
      savingAuto={controller.savingAuto}
      autoStart={controller.autoStart}
      cliProblem={controller.cliProblem}
      cliReason={controller.cliReason}
      launchProblem={controller.launchProblem}
      problem={controller.problem}
      loadFailed={controller.failed}
      onTool={controller.chooseTool}
      onModel={controller.chooseModel}
      onStart={controller.start}
      onStop={controller.stop}
      onAutoStart={controller.setAutoStart}
      onCheckAgain={controller.checkAgain}
    />
  );
}
