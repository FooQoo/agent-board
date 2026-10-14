---
title: The board
---

# The board

## Cards and progress

1. Select a project in the header and choose **Add card**.
2. Enter the title, choose AI or User as the owner, and write the body. Expand the acceptance panel at the bottom to add completion conditions.
3. Select a card for its **Description**, **Conditions**, **History**, and **Epic** tabs. The Conditions tab shows only the card's own conditions. To edit the card or assign an epic, choose **Make draft**, then open the editor. To move it to another column, drag it there and confirm the reason.

![Card details panel with the Conditions tab showing the card's acceptance conditions](../images/guide/card-detail.png){.screenshot}

The panel on the right shows the selected card. The Conditions tab lists the card's own acceptance conditions with its progress bar. Epic reference conditions remain in the epic's Markdown plan.

A card's owner is fixed after creation. The columns describe work progress:

| Column | Meaning |
| --- | --- |
| Todo | Work that has not started. |
| Doing | Work in progress. AI-owned cards also show an agent state. |
| Done | Completed work. |

AI-owned cards in Doing show **Idle**, **Running**, or **Pending**. Todo cards can also be Pending when an agent asks a question before starting work. User-owned cards and Done cards are always Idle. Running means the agent is working; Pending means it needs a response. A lane change resets the agent state to Idle and withdraws an open question. Changes and their reasons remain in the history.

To answer a Pending question, see [Decisions](./decisions).

## Drafts

Use the **Draft** checkbox when creating a card that agents should leave alone. For an existing card, choose **Make draft** in the detail panel, edit and save its text, then choose **Finalize** when it is ready for an agent. Saving in the card editor keeps its draft state; the editor has no Draft checkbox. Draft cards are read-only for agents, including their `TASK.md` files.

## Archive

Archive an individual card, or select **Archive completed cards** in Done to archive several cards together. Open **Archive** in the header to review archived cards, restore them, or delete them permanently. Permanent deletion in the browser is available from Archive.

![Archive screen listing five archived cards with a Back to board button](../images/guide/archive.png){.screenshot}

The Archive screen lists archived cards with their ID, title, date, and owner. Select a card to see its details, restore it to its original lane, or delete it permanently.

## Language and theme

Open **Settings** to choose English or Japanese and one of 24 themes (12 colors, each in light and dark). Changes apply immediately and are saved in your browser. The initial settings are English and light blue; they do not follow the browser or OS settings. Card content is not translated. CLI help, errors, and API/JSON values remain in English.

![Settings dialog with the language switch and the light and dark color theme choices](../images/guide/settings.png){.screenshot}

The dialog has a language switch and a grid of themes: one row of 12 light colors and one row of 12 dark colors.

![The board in a dark theme](../images/guide/board-dark.png){.screenshot}

The same board after choosing a dark theme.
