import { expect, type Locator, type Page } from '@playwright/test';

/** The answer button a waiting card shows; its label is "Answer the question" or "Continue answering". */
export const answerButton = (page: Page, id = 12): Locator =>
  page.locator(`[data-decision-answer][data-task-id="${id}"]`);

/** The open answer dialog. */
export const answerDialog = (page: Page): Locator => page.getByRole('dialog');

export const answerNote = (page: Page): Locator =>
  answerDialog(page).getByRole('textbox', { name: 'Note' });

export const answerSend = (page: Page): Locator =>
  answerDialog(page).getByRole('button', { name: 'Send', exact: true });

/** Presses the card's button and waits for the dialog. */
export async function openAnswer(page: Page, id = 12): Promise<Locator> {
  await answerButton(page, id).click();
  const dialog = answerDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

export interface AnswerInput {
  /** The label of the option to choose. */
  choice?: string;
  /** The note. */
  text?: string;
}

/** Opens the card's dialog, fills it and sends; the dialog closes when the answer is saved. */
export async function sendAnswer(page: Page, id: number, input: AnswerInput): Promise<void> {
  const dialog = await openAnswer(page, id);
  if (input.choice !== undefined) await dialog.getByRole('radio', { name: input.choice }).check();
  if (input.text !== undefined) await dialog.getByRole('textbox', { name: 'Note' }).fill(input.text);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog).toBeHidden();
}
