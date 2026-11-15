import { expect, type Locator, type Page } from '@playwright/test';

/** The answer button a waiting card shows; its label is "Answer the question" or "Continue answering". */
export const answerButton = (page: Page, id = 12): Locator =>
  page.locator(`[data-decision-answer][data-task-id="${id}"]`);

/** The band of unanswered questions above the lanes (or under the phone screen's counts). */
export const questionBand = (page: Page): Locator =>
  page.getByRole('region', { name: /^(Unanswered questions|未回答の質問)$/ });

/** The header button of the band: it opens and closes the list of questions, which starts closed. */
export const bandToggle = (page: Page): Locator =>
  questionBand(page).getByRole('button', { name: /^(Show|Hide) unanswered questions|^未回答の質問を(表示する|隠す)/ });

/** The count the band's header shows. */
export const bandCount = (page: Page): Locator => questionBand(page).locator('.question-band__count');

/** Opens the band's list when it is closed; the band does nothing while it has no question. */
export async function expandBand(page: Page): Promise<void> {
  const toggle = bandToggle(page);
  await expect(toggle).toBeEnabled();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** The open answer dialog. */
export const answerDialog = (page: Page): Locator => page.getByRole('dialog');

export const answerNote = (page: Page): Locator =>
  answerDialog(page).getByRole('textbox', { name: 'Note' });

/** The button that sends: "Send" on the last question of a card's run, "Send all" on the review of the band's run. */
export const sendLabel = /^(Send|Send all|送る|まとめて送る)$/;
export const answerSend = (page: Page): Locator => answerDialog(page).getByRole('button', { name: sendLabel });

/** Presses the card's button and waits for the dialog with its question. */
export async function openAnswer(page: Page, id = 12): Promise<Locator> {
  await answerButton(page, id).click();
  const dialog = answerDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.decision-panel')).toBeVisible();
  return dialog;
}

/**
 * Goes to the step that sends: the last question of a card's run (button "Send", no review), or the
 * review of a run opened from the band (button "Send all"). Steps through Next, which is bounded so
 * it cannot spin when there is none.
 */
export async function reachSend(page: Page): Promise<Locator> {
  const dialog = answerDialog(page);
  const send = dialog.getByRole('button', { name: sendLabel });
  const next = dialog.getByRole('button', { name: /^(Next|次へ)$/ });
  for (let step = 0; step < 50 && (await send.count()) === 0; step++) {
    if ((await next.count()) > 0) await next.click();
    else {
      const review = dialog.getByRole('navigation').getByRole('button', { name: /^(Review and send|確認して送る)$/ });
      await expect(review.or(send).first()).toBeVisible();
      if ((await review.count()) > 0) await review.click();
    }
  }
  await expect(send).toBeVisible();
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

/** Goes to the sending step and presses its button, without waiting for the outcome. */
export async function pressSend(page: Page): Promise<Locator> {
  const dialog = await reachSend(page);
  await dialog.getByRole('button', { name: sendLabel }).click();
  return dialog;
}

/** Goes to the sending step and sends; the dialog closes when the answers are saved. */
export async function send(page: Page): Promise<void> {
  const dialog = await pressSend(page);
  await expect(dialog).toBeHidden();
}

/** Opens the card's dialog, fills its question, and sends it (a card's run needs no review). */
export async function sendAnswer(page: Page, id: number, input: AnswerInput): Promise<void> {
  const dialog = await openAnswer(page, id);
  await fillAnswer(dialog, input);
  await send(page);
}
