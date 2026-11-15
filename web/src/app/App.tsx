import { lazy, Suspense } from 'react';
import { AppDialogs } from './AppDialogs';
import { BoardWorkspace } from './BoardWorkspace';
import { useAppActions } from './useAppActions';
import { useAppController } from './useAppController';
import type { AppInitial } from './contracts';
import { PcDataProvider } from './data/PcData';
import { StalePageNotice } from '../shared/ui/stale-page-notice/StalePageNotice';
import { useNarrowViewport } from '../shared/lib/viewport/useNarrowViewport';

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

  return (
    <div className="app" data-layout={narrow ? 'mobile' : 'desktop'}>
      {narrow ? (
        <>
          {model.stalePage ? <StalePageNotice /> : null}
          <Suspense fallback={null}>
            <MobileBoard model={model} actions={actions.workspace} />
          </Suspense>
        </>
      ) : (
        <BoardWorkspace model={model} actions={actions.workspace} />
      )}
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
