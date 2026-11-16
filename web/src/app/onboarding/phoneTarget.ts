// The phone presentation of the guide's spotlight: it frames the sample cards in the lane on the
// phone screen, measured from the lane itself, and offers copies of them inside the frame.

import { useCallback, useLayoutEffect, useState } from 'react';
import type { TaskSummary } from '../../shared/api/contracts';
import type { Task } from '../../shared/api/contracts';
import type { MonitorTask } from '../../pages/monitor/contracts';
import type { SpotlightRect } from '../../shared/ui/spotlight/Spotlight';

/** The gap between the frame's bottom and the guide panel, in pixels. */
const PANEL_GAP = 12;
/** The room around the cards inside the frame, in pixels. */
const FRAME_PAD = 4;

/** How long a lane takes to slide onto the screen, in milliseconds; the frame follows it. */
const SLIDE_MS = 700;

const listCard = (taskId: number) =>
  document.querySelector<HTMLElement>(`.monitor-lane .monitor-card[data-task-id="${taskId}"]`);

/**
 * The frame of the phone lane's cards with these IDs, in viewport pixels; `null` when none is on the
 * screen. The first card is scrolled to the top of its lane when the cards change, since the stage
 * holds the page's own scrolling, and the frame follows the lane while it slides onto the screen.
 * The frame ends above the explanation panel; taller cards scroll inside it.
 */
export function usePhoneTargetRect(taskIds: readonly number[]): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const key = taskIds.join(',');
  const measure = useCallback(() => {
    const cards = key === '' ? [] : key.split(',').map((id) => listCard(Number(id)));
    const boxes = cards.flatMap((card) => (card ? [card.getBoundingClientRect()] : []));
    if (boxes.length === 0) {
      setRect(null);
      return;
    }
    const left = Math.min(...boxes.map((box) => box.left));
    const right = Math.max(...boxes.map((box) => box.right));
    const top = Math.min(...boxes.map((box) => box.top)) - FRAME_PAD;
    const panel = document.querySelector<HTMLElement>('.onboarding-panel');
    const panelTop = panel ? panel.getBoundingClientRect().top : window.innerHeight;
    const next = {
      x: left - FRAME_PAD,
      y: top,
      width: right - left + FRAME_PAD * 2,
      maxHeight: Math.max(0, panelTop - PANEL_GAP - top),
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
  }, [key]);
  useLayoutEffect(() => {
    // The explanation panel covers the bottom of the screen: the lane gets room under its last card,
    // so the framed cards can always be scrolled above the panel.
    const first = key === '' ? null : listCard(Number(key.split(',')[0]));
    const list = first?.closest<HTMLElement>('.monitor-lane__scroll') ?? null;
    const padded = list?.style.paddingBottom ?? '';
    const place = () => {
      const panel = document.querySelector<HTMLElement>('.onboarding-panel');
      if (list && panel)
        list.style.paddingBottom = `${panel.getBoundingClientRect().height + 24}px`;
      // Only the lane scrolls: scrolling the card into view would also move the lanes sideways.
      if (list && first)
        list.scrollTop += first.getBoundingClientRect().top - list.getBoundingClientRect().top;
      measure();
    };
    place();
    // The panel is drawn after this effect on the first render, and the lane may still be sliding
    // onto the screen: place the cards on every frame until it is there. After that the frame keeps
    // following the cards, since what the lane draws above them, such as the done lane's archive
    // button, can arrive later and push them down without resizing the page.
    const until = performance.now() + SLIDE_MS;
    let frame = 0;
    const follow = () => {
      if (performance.now() < until) place();
      else measure();
      frame = window.requestAnimationFrame(follow);
    };
    frame = window.requestAnimationFrame(follow);
    return () => {
      window.cancelAnimationFrame(frame);
      if (list) list.style.paddingBottom = padded;
    };
  }, [key, measure]);
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
