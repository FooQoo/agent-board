// The guide's controller. The guide runs in the browser: its two sample cards are local values
// that the steps change, and the server only learns whether the guide has been seen. The view
// parts take only props; the timers and the one request live here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { i18n } from '../../shared/i18n';
import type { ProjectId } from '../../shared/api/contracts';
import { type GuideOutcome, markGuideSeen, readGuide } from './api';
import type { GuideController } from './guideController';
import { type GuideLocale, sampleCards } from './guideSamples';
import { type GuidePhase, type GuideScreen, RUNNING_MIN_MS } from './guideTiming';
import { useTutorialReplay } from './useTutorialReplay';

/** The next step from each step the user moves on with the explanation's button. */
const NEXT: Partial<Record<GuidePhase, GuidePhase>> = {
  samples: 'first-running',
  'first-running': 'first-done',
  'first-done': 'question',
  'second-running': 'second-done',
};

/**
 * The guide. `eligible` is true only when the board is ready and nothing else is being edited,
 * answered, or moved. The guide is offered once while the server says it is unseen, and the
 * settings can show it again whatever the server says.
 */
export function useGuide({
  projectId,
  eligible,
}: {
  projectId: ProjectId | null;
  eligible: boolean;
}): GuideController {
  const [screen, setScreen] = useState<GuideScreen>({ kind: 'hidden' });
  const [phase, setPhase] = useState<GuidePhase>('samples');
  const [ready, setReady] = useState(false);
  const [locale, setLocale] = useState<GuideLocale>('en');
  // Set when the guide was offered, not asked for: only an offered guide records how it ended.
  const offered = useRef(false);
  // The last project whose guide was read, so the first read and the offer run once per project.
  const checked = useRef<ProjectId | null>(null);
  // A fixed time, so the sample cards keep the same age for the whole run.
  const startedAt = useRef(new Date().toISOString());

  const show = useCallback((fromOffer: boolean) => {
    offered.current = fromOffer;
    setLocale(i18n.resolvedLanguage === 'ja' ? 'ja' : 'en');
    setPhase('samples');
    startedAt.current = new Date().toISOString();
    setScreen({ kind: 'welcome' });
  }, []);

  // Offer the guide once the board is ready, when the data area has not seen it.
  useEffect(() => {
    if (!eligible || !projectId || checked.current === projectId) return;
    checked.current = projectId;
    void readGuide()
      .then((current) => {
        if (current.status === 'unseen') show(true);
      })
      // The guide is optional: a failed read shows nothing and the board stays usable.
      .catch(() => {});
  }, [eligible, projectId, show]);

  // The settings' "Try it" shows the welcome on this screen, whatever the server says.
  useTutorialReplay({
    eligible,
    hidden: screen.kind === 'hidden',
    onReplay: () => show(false),
  });

  // Leaves the guide at once. A failed record must not hold the user: the guide is offered again.
  const leave = useCallback((outcome: GuideOutcome | null) => {
    setScreen({ kind: 'hidden' });
    if (outcome) void markGuideSeen(outcome).catch(() => {});
  }, []);

  // A running card stays on screen for at least RUNNING_MIN_MS before its step can move on.
  useEffect(() => {
    setReady(false);
    if (phase !== 'first-running' && phase !== 'second-running') return undefined;
    const timer = window.setTimeout(() => setReady(true), RUNNING_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const move = useCallback((to: GuidePhase) => {
    setPhase(to);
    setScreen({ kind: to === 'second-done' ? 'complete' : 'step' });
  }, []);

  // The explanation's button. A running card's step is enabled only once the card has been on
  // screen long enough.
  const next = useCallback(() => {
    const to = NEXT[phase];
    if (to && (ready || (phase !== 'first-running' && phase !== 'second-running'))) move(to);
  }, [move, phase, ready]);

  const answered = useCallback(() => {
    if (phase === 'question') move('second-running');
  }, [move, phase]);

  const start = useCallback(() => setScreen({ kind: 'step' }), []);
  const exit = useCallback(() => leave(offered.current ? 'skipped' : null), [leave]);
  const finish = useCallback(() => leave('completed'), [leave]);
  const samples = useMemo(() => sampleCards(locale, phase, startedAt.current), [locale, phase]);

  return { screen, phase, samples, locale, ready, start, skip: exit, next, exit, finish, answered };
}
