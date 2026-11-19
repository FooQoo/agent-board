import type { ModelOption, SessionsSnapshot, SessionTool } from './api';
import type { Choice, CliProblem } from './state';

/** A launch or stop request in flight: the controls are disabled and the button says what is happening. */
export type Pending = 'starting' | 'stopping' | null;

/** The last failed request, with the server's reason, for the card to show under the controls. */
export interface ResidentProblem {
  code: string | null;
  reason: string | null;
  /** The request could not reach the server at all. */
  unreachable: boolean;
}

/** Everything the dialog's body draws and can ask for; the controller fills it in, the stories fix it. */
export interface ResidentPanelProps {
  snapshot: SessionsSnapshot;
  /** The project this screen belongs to. */
  projectId: string;
  /** The tool and model chosen for the next start. */
  choice: Choice;
  /** The chosen tool's models; null while the list loads. */
  models: { options: readonly ModelOption[]; reason: string | null } | null;
  pending: Pending;
  /** The auto-start choice is being saved. */
  savingAuto: boolean;
  autoStart: boolean;
  cliProblem: CliProblem | null;
  /** The server's reason for the CLI problem. */
  cliReason: string | null;
  /** A failed launch that is not a CLI problem. */
  launchProblem: ResidentProblem | null;
  /** A failed stop or auto-start save. */
  problem: ResidentProblem | null;
  /** The last read of the sessions failed; the snapshot is the one before it. */
  loadFailed: boolean;
  /** Draw the external sessions list opened (it starts collapsed). */
  externalOpen?: boolean;
  onTool: (tool: SessionTool) => void;
  onModel: (model: string) => void;
  onStart: () => void;
  onStop: () => void;
  onAutoStart: (enabled: boolean) => void;
  onCheckAgain: () => void;
}
