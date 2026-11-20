import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Button } from '@/shared/ui/button';
import { ConfirmPanel } from '@/shared/ui/confirm-panel';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';
import { RadioGroup } from '@/shared/ui/radio-group';
import type { SessionTool } from '../api';
import {
  TOOLS,
  deriveState,
  differsFromRunning,
  isActive,
  isBusy,
  isForOtherProject,
  modelValue,
  toolName,
} from '../state';
import type { ResidentPanelProps, ResidentProblem } from '../types';
import { ModelPicker } from './ModelPicker';
import { CliProblemNote, SessionFacts } from './SessionFacts';
import { StateBadge } from './StateBadge';

const COMMANDS: Record<SessionTool, { command: string; loginCommand: string }> = {
  'claude-code': { command: 'claude', loginCommand: 'claude auth login' },
  codex: { command: 'codex', loginCommand: 'codex login' },
};

/** The text under the controls for a failed request: the server's reason, or that it was unreachable. */
function useProblemText() {
  const { t } = useTranslation();
  return (problem: ResidentProblem, key: 'startFailed' | 'requestFailed') =>
    t(`resident.${key}`, {
      reason: problem.unreachable
        ? t('resident.unreachable')
        : (problem.reason ?? t('resident.noReason')),
    });
}

/** The one card: the state first, then the choices, auto-start and Start/Stop. */
export function SessionCard(props: ResidentPanelProps) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const id = useId();
  const { snapshot, choice, models, pending, autoStart, cliProblem, projectId } = props;
  const { health } = snapshot;
  const state = deriveState(health);
  const running = isActive(state);
  const [asking, setAsking] = useState(false);
  // Asked only while the session is still mid-turn: if it goes idle meanwhile, the question lapses.
  const confirmingStop = asking && isBusy(state) && pending === null;
  const busy = pending !== null || props.savingAuto;
  const blocked = cliProblem !== null && !running;
  const shown = running && health.tool ? health.tool : choice.tool;
  const differs = differsFromRunning(health, choice);
  const modelList = models?.options ?? [];
  // Only the default is on offer when the list is unreadable or empty.
  const pickerOff = busy || models === null || modelList.length === 0 || models.reason !== null;

  const label =
    pending === 'starting'
      ? t('resident.starting')
      : pending === 'stopping'
        ? t('resident.stopping')
        : running
          ? t('resident.stop')
          : state === 'failed'
            ? t('resident.restart')
            : t('resident.start');

  return (
    <section
      className="resident-card"
      aria-labelledby={`${id}-name`}
      aria-busy={pending !== null}
      data-state={state}
    >
      <div className="resident-card__head">
        <h3 className="resident-card__name" id={`${id}-name`}>
          {toolName(shown)}
        </h3>
        <StateBadge state={state} />
      </div>

      {cliProblem !== null && !running ? (
        <CliProblemNote
          problem={cliProblem}
          tool={choice.tool}
          {...COMMANDS[choice.tool]}
          reason={props.cliReason}
          onCheckAgain={props.onCheckAgain}
        />
      ) : (
        <SessionFacts snapshot={snapshot} />
      )}
      {running && isForOtherProject(health, projectId) && (
        <p className="resident-note">{t('resident.otherProject')}</p>
      )}

      <div className="resident-controls">
        <div className="resident-controls__tool">
          <span className="resident-label" id={`${id}-tool`}>
            {t('resident.toolLabel')}
          </span>
          <RadioGroup
            className="segmented"
            aria-labelledby={`${id}-tool`}
            value={choice.tool}
            onValueChange={(next) => props.onTool(next as SessionTool)}
            disabled={busy}
          >
            {TOOLS.map((tool) => (
              <RadioGroupPrimitive.Item key={tool} value={tool} className="segmented__option">
                {toolName(tool)}
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroup>
        </div>
        <div className="resident-controls__model">
          <Label htmlFor={`${id}-model`}>{t('resident.modelLabel')}</Label>
          <ModelPicker
            id={`${id}-model`}
            value={modelValue(choice.model)}
            models={modelList}
            onChange={props.onModel}
            disabled={pickerOff}
          />
        </div>
        {models !== null && models.reason !== null && (
          <p className="resident-note resident-controls__wide" role="status">
            {models.reason
              ? t('resident.modelUnreadableWhy', { reason: models.reason })
              : t('resident.modelUnreadable')}
          </p>
        )}
        {differs && (
          <p className="resident-hint resident-controls__wide" role="status">
            {t('resident.nextStart', {
              tool: toolName(choice.tool),
              model: modelValue(choice.model) || t('resident.modelDefault'),
            })}
          </p>
        )}
        <div className="resident-controls__auto">
          <Checkbox
            id={`${id}-auto`}
            checked={autoStart}
            onCheckedChange={(next) => props.onAutoStart(next === true)}
            disabled={busy}
          />
          <Label htmlFor={`${id}-auto`} className="resident-controls__autolabel">
            {t('resident.autoStart')}
          </Label>
        </div>
        {confirmingStop && (
          <ConfirmPanel
            className="resident-controls__wide"
            title={t('resident.stopBusyTitle')}
            message={t('resident.stopBusyBody')}
            confirmLabel={t('resident.stopBusyConfirm')}
            cancelLabel={t('resident.stopBusyCancel')}
            busy={false}
            focusOnMount
            onConfirm={() => {
              setAsking(false);
              props.onStop();
            }}
            onCancel={() => setAsking(false)}
          />
        )}
        <Button
          type="button"
          variant="outline"
          size="m"
          className="resident-controls__action"
          disabled={blocked || busy}
          onClick={running ? (isBusy(state) ? () => setAsking(true) : props.onStop) : props.onStart}
        >
          {label}
        </Button>
        {props.launchProblem && (
          <p className="resident-error resident-controls__wide" role="alert">
            {problemText(props.launchProblem, 'startFailed')}
          </p>
        )}
        {props.problem && (
          <p className="resident-error resident-controls__wide" role="alert">
            {problemText(props.problem, 'requestFailed')}
          </p>
        )}
      </div>
    </section>
  );
}
