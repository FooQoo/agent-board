import { AppDialogs } from './AppDialogs';
import { BoardWorkspace } from './BoardWorkspace';
import { useAppActions } from './useAppActions';
import { useAppController } from './useAppController';
import type { AppInitial } from './contracts';
import { PcDataProvider } from './data/PcData';

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

function AppScreen({ initial }: AppProps) {
  const model = useAppController(initial);
  const actions = useAppActions(model);

  return (
    <div className="app">
      <BoardWorkspace model={model} actions={actions.workspace} />
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
