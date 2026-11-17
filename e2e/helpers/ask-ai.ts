import { expect, type Locator, type Page } from '@playwright/test';
import { pasteMarkdown } from './ui';

/** Opens the "Ask AI" dialog from the board header and waits for it. */
export async function openAskAi(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^(Ask AI|AI に依頼)$/ }).click();
  const dialog = page.getByRole('dialog', { name: /^(Ask AI|AI に依頼)$/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The request text field of the open Ask AI dialog (a rich editor). */
export const requestField = (dialog: Locator): Locator =>
  dialog.getByRole('textbox', { name: /^(What would you like done\?|何をしてほしいですか？)$/ });

/** Puts the request text into the field the way a paste does. */
export async function fillRequest(dialog: Locator, text: string): Promise<void> {
  await pasteMarkdown(requestField(dialog), text);
}

/**
 * Presses "Send request". The editor hands its text to the form a moment after a paste, so a click that comes too
 * soon is refused with "Enter your request."; the click is repeated until the dialog closes.
 */
export async function sendRequest(dialog: Locator): Promise<void> {
  await expect(async () => {
    await dialog.getByRole('button', { name: /^(Send request|依頼する)$/ }).click({ timeout: 2000 });
    await expect(dialog).toBeHidden({ timeout: 2000 });
  }).toPass({ timeout: 10_000 });
}
