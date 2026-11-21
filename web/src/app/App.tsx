import { lazy, Suspense, useMemo, useState } from 'react';
import { AppDialogs } from './AppDialogs';
import { useAppActions } from './useAppActions';
import { useAppController } from './useAppController';
import type { AppInitial } from './contracts';
import { PcDataProvider } from './data/PcData';
import { TransientNotice } from '../shared/ui/transient-notice/TransientNotice';
import { StalePageNotice } from '../shared/ui/stale-page-notice/StalePageNotice';
import { NARROW_VIEWPORT_QUERY, useNarrowViewport } from '../shared/lib/viewport/useNarrowViewport';
import { preloadable } from '../shared/lib/lazy/preloadable';
import { createPhoneGuideLink } from '../features/onboarding/model/phoneGuideLink';
import { guideLayer } from './onboarding/lazyGuide';
import { NotificationDialogHost } from './notificationSlot';
import { ResidentDialogHost } from './residentSlot';
import { isProjectId } from './model/projectSession';
import { SendConfirm } from '../features/backlog/SendConfirm';

/** The phone layout loads when the window is first narrow, so the PC board's first load stays as it was. */
const MobileBoard = lazy(() => import('./mobile/MobileBoard'));

/**
 * The PC board is split out too, so a phone never downloads it (its drag and drop included). A wide
 * window starts fetching it as soon as this module runs, alongside the first render.
 */
export const boardWorkspace = preloadable(() =>
  import('./BoardWorkspace').then((module) => module.BoardWorkspace),
);
if (typeof window.matchMedia !== 'function' || !window.matchMedia(NARROW_VIEWPORT_QUERY).matches)
  void boardWorkspace.preload();

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
        <Suspense fallback={null}>
          <boardWorkspace.Component model={model} actions={actions.workspace} residentSessions />
        </Suspense>
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
          phone={phone}
        />
      </Suspense>
      {/* Above the width switch too: a dialog left open becomes a sheet when the window narrows. */}
      <ResidentDialogHost projectId={known && isProjectId(activeId) ? activeId : null} />
      <NotificationDialogHost />
      <TransientNotice message={actions.moveNotice} onDismiss={actions.dismissMoveNotice} />
      {actions.backlogSend.confirming ? (
        <SendConfirm
          kind={narrow ? 'sheet' : 'dialog'}
          to={actions.backlogSend.confirming.to}
          count={actions.backlogSend.confirming.ids.length}
          warned={actions.backlogSend.confirming.warned}
          busy={actions.backlogSend.busy}
          onConfirm={actions.backlogSend.confirm}
          onCancel={actions.backlogSend.cancel}
        />
      ) : null}
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
