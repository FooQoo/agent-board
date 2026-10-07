import type { Locator, Page } from '@playwright/test';

/** The text of a CodeMirror editor, one line per `.cm-line`, as the saved Markdown would read. */
export async function editorValue(editor: Locator): Promise<string> {
  const content = editor.locator('.cm-content').or(editor);
  return content
    .first()
    .evaluate((element) =>
      [...element.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n'),
    );
}

/** The request of a pending card, above the tabs of the details, where an answer is typed in place. */
export function decisionRequest(details: Locator, name = 'The agent is waiting for your answer'): Locator {
  return details.getByRole('region', { name });
}

/** Wait for the board to show it is in sync, so the page is ready to use. */
export async function waitForSync(page: Page): Promise<void> {
  await page.getByRole('contentinfo').getByRole('status').filter({ hasText: /^(Synced|同期済み)/ }).waitFor();
}
