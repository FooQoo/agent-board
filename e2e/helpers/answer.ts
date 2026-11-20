import { expect, type Locator, type Page } from '@playwright/test';

/** The answer button a waiting card shows; its label is "Answer the question". It opens that question in the messages dialog. */
export const answerButton = (page: Page, id = 12): Locator =>
  page.locator(`[data-decision-answer][data-task-id="${id}"]`);

/** The Messages band above the lanes (or under the phone screen's counts). */
export const messageBand = (page: Page): Locator => page.getByRole('region', { name: /^(Messages|メッセージ)$/ });

/** The phone screen's bottom bar. */
export const phoneBar = (page: Page): Locator =>
  page.getByRole('navigation', { name: /^(Main navigation|主なナビゲーション)$/ });

/** The bar's Messages item; its number counts the open questions and is missing at 0. */
export const messagesItem = (page: Page): Locator =>
  phoneBar(page).getByRole('button', { name: /^(Messages|メッセージ)/ });

/** The bar's Ask item (its name is "Ask AI"). */
export const askItem = (page: Page): Locator => phoneBar(page).getByRole('button', { name: /^(Ask AI|AI に依頼)$/ });

/** What opens the list of messages: the band's button on the board, the bar's Messages item on the phone screen. */
export const openListButton = (page: Page): Locator =>
  messageBand(page)
    .getByRole('button', { name: /^(Questions & requests|質問・依頼を確認)$/ })
    .or(messagesItem(page));

/** The number of open questions the screen shows: the band's first count on the board, the bar's number on the phone screen. */
export async function openQuestionCount(page: Page): Promise<number> {
  // The layout follows the window width: below 768px the phone screen (the bar), otherwise the board (the band).
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await phoneBar(page).waitFor();
    const label = (await messagesItem(page).getAttribute('aria-label')) ?? '';
    return Number(/\s(\d+)\+?$/.exec(label)?.[1] ?? 0);
  }
  const chip = messageBand(page)
    .getByRole('listitem')
    .filter({ hasText: /^(AI's questions|AI の質問)/ });
  return Number(/(\d+)\s*$/.exec(await chip.innerText())?.[1] ?? NaN);
}

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

/**
 * Sends the open question's answer. When the answer is saved the question leaves the dialog: the list of the
 * other messages shows in its place, or the dialog closes when nothing is left.
 */
export async function send(page: Page): Promise<void> {
  const dialog = await pressSend(page);
  await expect(dialog.getByRole('region', { name: /^(Your answer|あなたの回答)$/ })).toHaveCount(0);
}

/** Opens the card's question, fills it, and sends it. */
export async function sendAnswer(page: Page, id: number, input: AnswerInput): Promise<void> {
  const dialog = await openAnswer(page, id);
  await fillAnswer(dialog, input);
  await send(page);
}
