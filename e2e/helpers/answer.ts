import { expect, type Locator, type Page } from '@playwright/test';

/** The answer button a waiting card shows; its label is "Answer the question". It opens that question in the messages dialog. */
export const answerButton = (page: Page, id = 12): Locator =>
  page.locator(`[data-decision-answer][data-task-id="${id}"]`);

/** The Messages band above the lanes (or under the phone screen's counts). */
export const messageBand = (page: Page): Locator => page.getByRole('region', { name: /^(Messages|メッセージ)$/ });

/** The band's button that opens the list of messages. */
export const openListButton = (page: Page): Locator =>
  messageBand(page).getByRole('button', { name: /^(Open the list|一覧を開く)$/ });

/** The messages dialog: the list, a question or a request, or the plan review (a sheet on a phone). */
export const answerDialog = (page: Page): Locator => page.getByRole('dialog');

/** The messages list dialog, once it is open. */
export const messageList = (page: Page): Locator => page.getByRole('dialog', { name: /^(Messages|メッセージ)$/ });

/** Opens the list from the band and waits for it. */
export async function openMessageList(page: Page): Promise<Locator> {
  await openListButton(page).click();
  const list = messageList(page);
  await expect(list).toBeVisible();
  return list;
}

/** A row of the list, found by the start of its accessible name, such as "Question AI" or "Request You". */
export const listRow = (page: Page, kind: RegExp): Locator => messageList(page).getByRole('button', { name: kind });

/** The note field of the open question. */
export const answerNote = (page: Page): Locator => answerDialog(page).getByRole('textbox', { name: /^(Note|メモ)$/ });

/** The button that sends the answer of the open question. */
export const sendLabel = /^(Send answer|回答を送る)$/;
export const answerSend = (page: Page): Locator => answerDialog(page).getByRole('button', { name: sendLabel });

/** The button that closes the open question without answering it. */
export const laterButton = (page: Page): Locator =>
  answerDialog(page).getByRole('button', { name: /^(Later|あとでやる)$/ });

/** Presses the card's button and waits for the dialog with its question. */
export async function openAnswer(page: Page, id = 12): Promise<Locator> {
  await answerButton(page, id).click();
  const dialog = answerDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: /^(Your answer|あなたの回答)$/ })).toBeVisible();
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
  if (input.text !== undefined) await dialog.getByRole('textbox', { name: /^(Note|メモ)$/ }).fill(input.text);
}

/** Presses the button that sends, without waiting for the outcome. */
export async function pressSend(page: Page): Promise<Locator> {
  const dialog = answerDialog(page);
  await dialog.getByRole('button', { name: sendLabel }).click();
  return dialog;
}

/** Sends the open question's answer; the dialog closes when the answer is saved. */
export async function send(page: Page): Promise<void> {
  const dialog = await pressSend(page);
  await expect(dialog).toBeHidden();
}

/** Opens the card's question, fills it, and sends it. */
export async function sendAnswer(page: Page, id: number, input: AnswerInput): Promise<void> {
  const dialog = await openAnswer(page, id);
  await fillAnswer(dialog, input);
  await send(page);
}
