import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The Markdown of the rich editor (ProseMirror), rebuilt from its blocks: headings get their `#` marks, list items
 * their `-` (or `- [ ]` / `- [x]` for task items), and every other block is its text. Blocks are separated by a
 * blank line, as the saved Markdown is. Milkdown wraps list items in extra elements, so items are found by their
 * `li` and only the outermost ones count.
 */
export async function editorValue(editor: Locator): Promise<string> {
  return editor.first().evaluate((root) => {
    const text = (element: Element) => (element.textContent ?? '').replace(/\u200b/g, '');
    const listItems = (list: Element) =>
      Array.from(list.querySelectorAll('li'))
        .filter((item) => item.parentElement?.closest('li') === null || item.parentElement?.closest('li') === undefined)
        .filter((item) => item.closest('ul, ol') === list)
        .map((item) => {
          const label = item.querySelector('.label');
          const mark = label ? (label.classList.contains('checked') ? '- [x] ' : '- [ ] ') : '- ';
          const own = Array.from(item.childNodes).filter((node) => !(node instanceof Element && node.matches('.label-wrapper, ul, ol')));
          return mark + own.map((node) => (node.textContent ?? '').replace(/\u200b/g, '')).join('').trim();
        });
    const blocks: string[] = [];
    for (const element of Array.from(root.children)) {
      if (element.classList.contains('prosemirror-virtual-cursor')) continue;
      const heading = /^H([1-6])$/.exec(element.tagName);
      if (heading) blocks.push(`${'#'.repeat(Number(heading[1]))} ${text(element)}`);
      else if (element.tagName === 'UL' || element.tagName === 'OL') blocks.push(listItems(element).join('\n'));
      else if (text(element).trim() !== '') blocks.push(text(element));
    }
    return blocks.join('\n\n');
  });
}

/** The request of a pending card, above the tabs of the details, where an answer is typed in place. */
export function decisionRequest(details: Locator, name = 'The agent is waiting for your answer'): Locator {
  return details.getByRole('region', { name });
}

/** Wait for the board to show it is in sync, so the page is ready to use. */
export async function waitForSync(page: Page): Promise<void> {
  await page.getByRole('contentinfo').getByRole('status').filter({ hasText: /^(Synced|同期済み)/ }).waitFor();
}

/**
 * Read the board again after the files under it were replaced. The server notices a changed file
 * 200 ms later, and the page holds the stream's updates back once a drawer or a dialog is open,
 * so a test that acts at once would work on the state before the change.
 */
export async function readBoardAfterReset(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^(Refresh|最新の状態に更新)$/ }).click();
  await waitForSync(page);
}

/**
 * Press refresh until `check` holds. For a change made while a drawer or a dialog is open: the page
 * holds the stream's updates back then, and the refresh button reads the board at once. The button is
 * pressed through the page because an open dialog makes the rest of the page inert.
 */
export async function refreshUntil(page: Page, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.locator('.header__refresh').evaluate((button) => (button as HTMLButtonElement).click());
    await check();
  }).toPass({ timeout: 15_000 });
}

/** Open the established full task editor from the Add task button's simple-request entry point. */
export async function openManualCreateDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^(Add task|タスク追加)$/ }).click();
  const request = page.getByRole('dialog', { name: /^(New task|新しいタスク)$/ });
  await request.getByRole('button', { name: /^(Create manually|手動で作成)$/ }).click();
  const dialog = page.getByRole('dialog', { name: /^(Add task|タスクを追加)/ });
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/**
 * Put Markdown into the rich editor the way a paste does. Typing a whole TASK.md body key by key mangles its
 * checklist lines, so a body with several blocks is pasted as plain text, which the editor parses as Markdown.
 */
export async function pasteMarkdown(editor: Locator, markdown: string): Promise<void> {
  await editor.click();
  await editor.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markdown);
}
