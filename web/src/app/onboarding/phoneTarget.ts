// The phone presentation of the guide's spotlight: it frames the top of the step's lane on the
// phone screen, measured from the lane itself, and the sample cards are drawn inside the frame.

import { useCallback, useLayoutEffect, useState } from 'react';
import type { TaskSummary } from '../../shared/api/contracts';
import type { Task } from '../../shared/api/contracts';
import type { MonitorTask } from '../../pages/monitor/contracts';
import type { SpotlightRect } from '../../shared/ui/spotlight/Spotlight';

/** The gap between the frame's bottom and the guide panel, in pixels. */
const PANEL_GAP = 12;

/** How long a lane takes to slide onto the screen, in milliseconds; the frame follows it. */
const SLIDE_MS = 700;

/**
 * The frame at the top of a phone lane's list, in viewport pixels; `null` without a lane. The lane
 * is scrolled to its top, since the stage holds the page's own scrolling, and the frame follows the
 * lane while it slides onto the screen. The frame ends above the explanation panel; taller cards
 * scroll inside it.
 */
export function usePhoneLaneRect(lane: string | null): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const measure = useCallback(() => {
    const list = lane
      ? document.querySelector<HTMLElement>(
          `.monitor-lane[data-lane="${lane}"] .monitor-lane__scroll`,
        )
      : null;
    if (!list) {
      setRect(null);
      return;
    }
    const box = list.getBoundingClientRect();
    const panel = document.querySelector<HTMLElement>('.onboarding-panel');
    const panelTop = panel ? panel.getBoundingClientRect().top : window.innerHeight;
    const next = {
      x: box.left,
      y: box.top,
      width: box.width,
      maxHeight: Math.max(0, panelTop - PANEL_GAP - box.top),
    };
    setRect((previous) =>
      previous &&
      previous.x === next.x &&
      previous.y === next.y &&
      previous.width === next.width &&
      previous.maxHeight === next.maxHeight
        ? previous
        : next,
    );
  }, [lane]);
  useLayoutEffect(() => {
    if (!lane) return undefined;
    const list = document.querySelector<HTMLElement>(
      `.monitor-lane[data-lane="${lane}"] .monitor-lane__scroll`,
    );
    if (list) list.scrollTop = 0;
    measure();
    // The panel is drawn after this effect on the first render, and the lane may still be sliding
    // onto the screen, so the frame follows the lane on every frame.
    const until = performance.now() + SLIDE_MS;
    let frame = 0;
    const follow = () => {
      if (list && performance.now() < until) list.scrollTop = 0;
      measure();
      frame = window.requestAnimationFrame(follow);
    };
    frame = window.requestAnimationFrame(follow);
    return () => window.cancelAnimationFrame(frame);
  }, [lane, measure]);
  return rect;
}

/** A board card as the phone's list draws it. */
export function phoneItemOf(
  card: TaskSummary,
  projectId: MonitorTask['projectId'],
  projectName: string,
): MonitorTask {
  const task: Task = {
    id: card.id,
    title: card.title,
    description: '',
    body: '',
    acceptance: Array.isArray(card.acceptance)
      ? card.acceptance
      : Array.from({ length: card.acceptance.total }, (_, index) => ({
          id: `AC-${index + 1}`,
          text: '',
          done: index < (card.acceptance as { done: number }).done,
        })),
    acceptanceError: card.acceptanceError ?? false,
    assignee: card.assignee,
    taskStatus: card.taskStatus,
    taskStatusChangedAt: card.taskStatusChangedAt,
    position: card.position,
    agentStatus: card.agentStatus,
    pendingReason: card.pendingReason,
    pendingRequestId: card.pendingRequestId,
    pendingChoices: card.pendingChoices,
    openQuestionIds: card.openQuestionIds ?? [],
    epic: card.epic ?? null,
    createdAt: card.createdAt ?? card.taskStatusChangedAt,
    updatedAt: card.updatedAt,
    agentStatusChangedAt: card.agentStatusChangedAt ?? card.taskStatusChangedAt,
    isDraft: card.isDraft,
    history: [],
    attachments: [],
  };
  return { projectId, projectName, task };
}
