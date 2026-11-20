import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '@/shared/lib/time/formatTime';
import type { SessionsSnapshot } from '../api';
import {
  deriveState,
  isActive,
  modelValue,
  secondsUntil,
  startedAt,
  toolName,
  waitingOn,
} from '../state';
import type { CliProblem } from '../state';
import { Button } from '@/shared/ui/button';

/** The clock for the retry countdown; it ticks every second only while it is needed. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** The facts under the heading: why it failed, when it retries, the model and since when. */
export function SessionFacts({ snapshot }: { snapshot: SessionsSnapshot }) {
  const { t } = useTranslation();
  const { health } = snapshot;
  const state = deriveState(health);
  const now = useNow(state === 'restarting');
  const since = startedAt(snapshot);
  const retry = secondsUntil(health.nextRestartAt, now);
  const restarts = t('resident.restarts', { count: health.restartCount });
  return (
    <dl className="resident-facts">
      {state === 'failed' && (
        <div className="resident-facts__row resident-facts__row--failed" role="alert">
          <dt>{t('resident.failedReason')}</dt>
          <dd>
            {health.reason ?? t('resident.noReason')}
            {health.restartCount > 0 && <span className="resident-facts__sub">{restarts}</span>}
            <span className="resident-facts__sub">{t('resident.failedStopped')}</span>
          </dd>
        </div>
      )}
      {state === 'restarting' && (
        <div className="resident-facts__row">
          <dd>
            {retry !== null && t('resident.retryIn', { seconds: retry })}
            {health.reason && <span className="resident-facts__sub">{health.reason}</span>}
            <span className="resident-facts__sub">{restarts}</span>
          </dd>
        </div>
      )}
      {isActive(state) && (
        <>
          {waitingOn(health).length > 0 && (
            <div className="resident-facts__row">
              <dt>{t('resident.waitingOnTitle')}</dt>
              <dd>
                {waitingOn(health).map((task) => (
                  <span className="resident-facts__sub" key={task}>
                    {task}
                  </span>
                ))}
              </dd>
            </div>
          )}
          <div className="resident-facts__row">
            <dd>
              {t('resident.modelInUse', {
                model: modelValue(health.model) || t('resident.modelDefault'),
              })}
            </dd>
          </div>
          {since && state !== 'restarting' && (
            <div className="resident-facts__row">
              <dd>
                {t('resident.since', { time: formatTime(new Date(since)) })}
                {health.restartCount > 0 && ` · ${restarts}`}
              </dd>
            </div>
          )}
        </>
      )}
    </dl>
  );
}

/** The chosen tool's CLI cannot start: what to do next, with the server's reason, and a recheck. */
export function CliProblemNote({
  problem,
  tool,
  command,
  loginCommand,
  reason,
  onCheckAgain,
}: {
  problem: CliProblem;
  tool: Parameters<typeof toolName>[0];
  command: string;
  loginCommand: string;
  reason: string | null;
  onCheckAgain: () => void;
}) {
  const { t } = useTranslation();
  const name = toolName(tool);
  return (
    <div className="resident-problem" role="alert">
      <p className="resident-problem__title">
        {problem === 'notFound'
          ? t('resident.notFoundTitle', { tool: name })
          : t('resident.loggedOutTitle', { tool: name })}
      </p>
      {reason && <p className="resident-problem__next">{reason}</p>}
      <p className="resident-problem__next">
        {problem === 'notFound'
          ? t('resident.notFoundNext', { command })
          : t('resident.loggedOutNext', { command: loginCommand })}
      </p>
      <Button type="button" variant="outline" size="s" onClick={onCheckAgain}>
        {t('resident.checkAgain')}
      </Button>
    </div>
  );
}
