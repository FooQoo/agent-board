import { expect, type Page } from '@playwright/test';
import { answerDialog } from './answer';

/** Closes the messages dialog that shows after an answer is sent (the list of the other messages), if it is open. */
export async function closeMessages(page: Page): Promise<void> {
  const dialog = answerDialog(page);
  if (await dialog.isVisible()) await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}
