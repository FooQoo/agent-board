---
title: Mobile monitor
---

# Mobile monitor

The mobile monitor is a phone-sized view of the board. Use it to check progress and to answer an agent's question when you are away from your desk. This page explains what the monitor shows, how to make the board reachable from your phone, and how to check that it works.

## What the monitor shows

The monitor groups tasks into Todo, Doing, and Done. AI-owned tasks show their agent state inline; Pending questions in Todo or Doing show an answer form on the task. Tapping a task opens a bottom drawer with **Body**, **Conditions**, **History**, and **Epic** tabs. The drawer slides up from the bottom, follows a downward drag of its top handle, and closes when dismissed; each tab's content scrolls independently. The Conditions tab shows only the task's own conditions; epic reference conditions remain in the epic details. The Epic tab shows the epic details without repeating the label or title already shown in the drawer and body. The monitor can answer a pending question, but its only write operation is that answer.

![Mobile monitor with a task drawer open on the Body tab, showing the four tabs](../../images/mobile.png){.screenshot--narrow}

Horizontal swipes move the tab content and underline together. Gestures inside the tab content stay within that area; drag the top handle to dismiss the drawer. Each project's complete epic list is loaded when the monitor initializes and retained for the page session. Switching tabs performs no epic request. Reload the page to refresh the epic lists, or use the retry button after a failed initial request.

The monitor HTML and API responses are never cached. The browser keeps the monitor's scripts and styles, so later visits download only the page and the data. The monitor has no offline snapshot cache or service worker.

After you install a new version and restart `agboard serve`, an open monitor reloads itself to show the new UI. If you are writing an answer, it waits until you send or clear it. When disconnected, the page reports the connection state.

## Reach it from your phone

The board listens only on your computer by default. A phone reaches the monitor through the ngrok monitor connection, which you start with `agboard serve --monitor ngrok`. The connection serves only the monitor, never the full board. Never expose the board to the public Internet and never use router port forwarding.

When the computer sleeps or the server stops, the monitor is unavailable until the server and the connection are running again.

## Check on a phone

Responsive browser tests cover narrow viewports; the software keyboard needs a real-device check. Open the monitor in the phone's browser and find a Todo or Doing task with a Pending question. Confirm that the keyboard leaves the answer field and Send button reachable, then submit an answer. Also check scrolling in long Body, Conditions, and Epic tabs, horizontal tab swipes, and downward dismissal using the handle. Browser emulation alone does not verify Safari's keyboard behavior.

## Next

- [Decisions](../use/decisions): answer a question from your phone.
- [Troubleshooting](./troubleshooting): the page does not load or does not update.
