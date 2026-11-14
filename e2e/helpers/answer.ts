import { expect, type Locator, type Page } from '@playwright/test';

/** The answer button a waiting card shows; its label is "Answer the question" or "Continue answering". */
export const answerButton = (page: Page, id = 12): Locator =>
  page.locator(`[data-decision-answer][data-task-id="${id}"]`);

/** The band of unanswered questions above the lanes (or under the monitor's counts). */
export const questionBand = (page: Page): Locator =>
  page.getByRole('region', { name: /^(Unanswered questions|未回答の質問)$/ });

/** The open answer dialog. */
export const answerDialog = (page: Page): Locator => page.getByRole('dialog');

export const answerNote = (page: Page): Locator =>
  answerDialog(page).getByRole('textbox', { name: 'Note' });

/** The review's button that sends every held answer at once. */
export const answerSend = (page: Page): Locator =>
  answerDialog(page).getByRole('button', { name: 'Send all', exact: true });

/** Presses the card's button and waits for the dialog with its question. */
export async function openAnswer(page: Page, id = 12): Promise<Locator> {
  await answerButton(page, id).click();
  const dialog = answerDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.decision-panel')).toBeVisible();
  return dialog;
}

/** Goes to the review, the last step of the progress (the dialog's tab or the sheet's Next). */
export async function openReview(page: Page): Promise<Locator> {
  const dialog = answerDialog(page);
  const step = dialog.getByRole('navigation').getByRole('button', { name: /^(Review and send|確認して送る)$/ });
  if ((await step.count()) > 0) await step.click();
  else
    while ((await dialog.getByRole('button', { name: /^(Send all|まとめて送る)$/ }).count()) === 0)
      await dialog.getByRole('button', { name: /^(Next|次へ)$/ }).click();
  await expect(dialog.getByRole('button', { name: /^(Send all|まとめて送る)$/ })).toBeVisible();
  return dialog;
}

export interface AnswerInput {
  /** The label of the option to choose. */
  choice?: string;
  /** The note. */
  text?: string;
}

/** Fills the question shown in the open dialog. */
export async function fillAnswer(dialog: Locator, input: AnswerInput): Promise<void> {
  if (input.choice !== undefined) await dialog.getByRole('radio', { name: input.choice }).check();
  if (input.text !== undefined) await dialog.getByRole('textbox', { name: 'Note' }).fill(input.text);
}

/** Goes to the review and presses Send all, without waiting for the outcome. */
export async function pressSendAll(page: Page): Promise<Locator> {
  const dialog = await openReview(page);
  await dialog.getByRole('button', { name: /^(Send all|まとめて送る)$/ }).click();
  return dialog;
}

/** Goes to the review and sends every held answer; the dialog closes when they are saved. */
export async function sendAll(page: Page): Promise<void> {
  const dialog = await pressSendAll(page);
  await expect(dialog).toBeHidden();
}

/** Opens the card's dialog, fills its question, and sends from the review. */
export async function sendAnswer(page: Page, id: number, input: AnswerInput): Promise<void> {
  const dialog = await openAnswer(page, id);
  await fillAnswer(dialog, input);
  await sendAll(page);
}
