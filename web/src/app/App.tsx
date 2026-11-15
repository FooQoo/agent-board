import { lazy, Suspense, useMemo, useState } from 'react';
import { AppDialogs } from './AppDialogs';
import { BoardWorkspace } from './BoardWorkspace';
import { useAppActions } from './useAppActions';
import { useAppController } from './useAppController';
import type { AppInitial } from './contracts';
import { PcDataProvider } from './data/PcData';
import { StalePageNotice } from '../shared/ui/stale-page-notice/StalePageNotice';
import { useNarrowViewport } from '../shared/lib/viewport/useNarrowViewport';
import { createPhoneGuideLink } from '../features/onboarding/model/phoneGuideLink';
import { guideLayer } from './onboarding/lazyGuide';
import { isProjectId } from './model/projectSession';

/** The phone layout loads when the window is first narrow, so the PC board's first load stays as it was. */
const MobileBoard = lazy(() => import('./mobile/MobileBoard'));

export interface AppProps {
  /** Mock mode only: initial UI state taken from the page URL (see `src/mock.ts`). */
  initial?: AppInitial;
}

/** Connects the project session to the workspace and its lazily loaded dialogs. */
export function App({ initial }: AppProps) {
  return (
    <PcDataProvider>
      <AppScreen initial={initial} />
    </PcDataProvider>
  );
}

/**
 * One controller serves both layouts: the active project, the held answers and the connection stay
 * above the width switch, so a change of width keeps them. Below 768px the phone screen replaces
 * the PC board; the dialogs stay, so a form left open is not lost.
 */
function AppScreen({ initial }: AppProps) {
  const model = useAppController(initial);
  const actions = useAppActions(model);
  const narrow = useNarrowViewport();
  const [guideLink] = useState(createPhoneGuideLink);
  const { session, known, activeId, activeName } = model;
  const phone = useMemo(
    () => (narrow ? { link: guideLink, projectName: activeName ?? '' } : null),
    [narrow, guideLink, activeName],
  );

  return (
    <div className="app" data-layout={narrow ? 'mobile' : 'desktop'}>
      {narrow ? (
        <>
          {model.stalePage ? <StalePageNotice /> : null}
          <Suspense fallback={null}>
            <MobileBoard model={model} actions={actions.workspace} guideLink={guideLink} />
          </Suspense>
        </>
      ) : (
        <BoardWorkspace model={model} actions={actions.workspace} />
      )}
      {/* One guide above the width switch: a change of width keeps the screen it is on. */}
      <Suspense fallback={null}>
        <guideLayer.Component
          projectId={known && isProjectId(activeId) ? activeId : null}
          eligible={
            known &&
            model.view === 'board' &&
            session.operation === null &&
            session.answerLeases.length === 0 &&
            !model.epicsVisible &&
            !model.archiveVisible &&
            !model.isMockTask
          }
          tasks={model.tasks}
          answers={model.answers.book}
          onAnswer={model.answers.openForTask}
          onAnswerChanged={actions.workspace.onAnswerChanged}
          phone={phone}
        />
      </Suspense>
      <AppDialogs
        model={model}
        onSubmit={actions.submitDialog}
        onCloseOperation={actions.closeOperation}
        onSavingChange={actions.savingChanged}
        onOpenTask={actions.openTaskFromEpic}
        onConfirmBulkArchive={actions.confirmBulkArchive}
        onCancelBulkArchive={actions.cancelBulkArchive}
        epicApi={actions.epicApiForOperation}
      />
    </div>
  );
}
