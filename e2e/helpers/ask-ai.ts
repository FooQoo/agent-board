import { expect, type Locator, type Page } from '@playwright/test';

/** Opens the "Ask AI" dialog from the board header and waits for it. */
export async function openAskAi(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^(Ask AI|AI に依頼)$/ }).click();
  const dialog = page.getByRole('dialog', { name: /^(Ask AI|AI に依頼)$/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The request text field of the open Ask AI dialog. */
export const requestField = (dialog: Locator): Locator =>
  dialog.getByRole('textbox', { name: /^(What would you like done\?|何をしてほしいですか？)$/ });

/** Types the request text into the field. */
export async function fillRequest(dialog: Locator, text: string): Promise<void> {
  await requestField(dialog).fill(text);
}

/** Presses "Send request" and waits for the dialog to close. */
export async function sendRequest(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: /^(Send request|依頼する)$/ }).click();
  await expect(dialog).toBeHidden();
}
