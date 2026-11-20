import { agboardOk, listTasks, mainProject, resetBoard } from '../helpers/agboard';
import { listRow, messagesItem, openMessageList } from '../helpers/answer';
import { expect, test } from '../helpers/fixtures';
import { resetPreferences, setPreferences } from '../helpers/preferences';

// An iPhone-sized touch screen, Japanese, dark.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// Positions and sizes are compared with 2px of room for subpixel rounding.
const tolerance = 2;

const question = `## 認証方式の選び方

**パスワード認証**を残すか、\`passkey\` に切り替えるかを決めてください。詳しくは [設計メモ](https://example.com/design) を参照。

- 既存ユーザーの扱い
  - 初回ログイン時に変換する
  - 再設定をお願いする
- 外部アカウント

1. 方式を決める
2. 移行日を決める

| 方式 | 利点 | 注意点 |
| --- | --- | --- |
| メールとパスワード | 既存のユーザーがそのまま使える | パスワードの再設定の問い合わせが増えるかもしれません |
| 外部アカウント | 入力の手間が少ない | 提供元の障害の影響を受けます |

\`\`\`css
.login-button:focus-visible { outline: 2px solid var(--r-accent); outline-offset: 2px; border-radius: 8px; }
\`\`\`

> 切り替えの間も、いまのログインは使えます。
`;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await setPreferences({ locale: 'ja', theme: { mode: 'dark', accent: 'blue' } });
  // iOS Safari keeps the layout viewport at full height and only shrinks the visual viewport when the
  // keyboard opens; a stand-in for it lets the test play that.
  await page.addInitScript(() => {
    const target = new EventTarget();
    const state = { shrink: 0 };
    const root = () => document.documentElement;
    const fake = Object.defineProperties(target, {
      height: { get: () => root().clientHeight - state.shrink },
      offsetTop: { get: () => 0 },
      width: { get: () => root().clientWidth },
    });
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard = (height) => {
      state.shrink = height;
      target.dispatchEvent(new Event('resize'));
    };
  });
  const id = listTasks(mainProject).find((task) => task.taskStatus === 'doing' && task.assignee === 'ai')!.id;
  agboardOk(mainProject, [
    'message', 'ask', '--actor', 'ai', '--no-wait', '--task', String(id), '--questions-json',
    JSON.stringify({
      questions: [{ body: question, choices: [{ id: 'mail', label: 'メールとパスワードだけ' }, { id: 'sso', label: '外部アカウントも足す' }] }],
    }),
  ]);
  await page.goto('/');
  await expect(messagesItem(page)).toBeVisible();
});

test.afterEach(() => resetPreferences());

test('a question opened from the list returns to it from the footer, and its content lines up at one edge', async ({ page }) => {
  const list = await openMessageList(page);
  await listRow(page, /認証方式の選び方/).click();
  const sheet = page.getByRole('dialog', { name: 'メッセージ' });
  const footer = sheet.locator('.surface__footer');
  await expect(footer.getByRole('button', { name: '回答を送る' })).toBeVisible();
  // The way back is the footer's left button, and the body starts with the question.
  await expect(sheet.getByRole('button', { name: '一覧へ戻る' })).toHaveCount(1);
  await expect(footer.getByRole('button', { name: '一覧へ戻る' })).toBeVisible();

  const body = sheet.locator('.surface__body');
  const left = async (locator: ReturnType<typeof sheet.locator>) => (await locator.boundingBox())?.x ?? NaN;
  const edges = [
    await left(sheet.getByRole('heading', { name: '認証方式の選び方' })),
    await left(sheet.getByRole('heading', { name: 'あなたの回答' })),
    await left(sheet.getByRole('radio', { name: 'メールとパスワードだけ' }).locator('xpath=ancestor::label')),
    await left(sheet.getByRole('textbox', { name: 'メモ' })),
  ];
  for (const edge of edges) expect(Math.abs(edge - 16)).toBeLessThanOrEqual(tolerance);

  // The sheet never scrolls sideways; the table and the code scroll inside themselves.
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(tolerance);
  for (const wide of ['.md-scroll', 'pre']) {
    const block = sheet.locator(wide).first();
    expect(await block.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(tolerance);
  }
  if (process.env.AB_SHOTS) await page.screenshot({ path: `${process.env.AB_SHOTS}/answer-closed.png` });
  if (process.env.AB_SHOTS) {
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.screenshot({ path: `${process.env.AB_SHOTS}/answer-bottom.png` });
    await body.evaluate((el) => el.scrollTo(0, 0));
  }

  await footer.getByRole('button', { name: '一覧へ戻る' }).click();
  await expect(list.getByRole('tab').first()).toBeVisible();
  await expect(footer).toHaveCount(0);
});

test('the answer sheet fills the visible area above the keyboard with its footer in view', async ({ page }) => {
  await openMessageList(page);
  await listRow(page, /認証方式の選び方/).click();
  const sheet = page.getByRole('dialog', { name: 'メッセージ' });
  const send = sheet.getByRole('button', { name: '回答を送る' });
  await expect(send).toBeInViewport({ ratio: 1 });
  const settle = () =>
    expect(async () => {
      const first = await sheet.boundingBox();
      await page.waitForTimeout(100);
      expect(await sheet.boundingBox()).toEqual(first);
    }).toPass();
  await settle();
  const closed = await sheet.boundingBox();
  await sheet.getByRole('textbox', { name: 'メモ' }).focus();

  await page.evaluate(() => (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard(336));
  await expect.poll(async () => (await send.boundingBox())?.y ?? 0).toBeLessThan(844 - 336);
  await settle();
  const opened = await sheet.boundingBox();
  const box = await send.boundingBox();
  if (!opened || !box || !closed) throw new Error('The sheet did not render.');
  if (process.env.AB_SHOTS) await page.screenshot({ path: `${process.env.AB_SHOTS}/answer-keyboard.png` });
  // The buttons end above the keyboard; the sheet runs from just under the status bar to the keyboard.
  expect(box.y + box.height).toBeLessThanOrEqual(844 - 336 + tolerance);
  expect(opened.y).toBeLessThanOrEqual(24 + tolerance);
  expect(opened.y + opened.height).toBeGreaterThanOrEqual(844 - 336 - tolerance);
  expect(opened.height).toBeLessThan(closed.height - tolerance);
  await expect(sheet.locator('.mobile-drawer__handle')).toBeVisible();
  await expect(sheet.getByRole('button', { name: '閉じる', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await sheet.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('336px');
  // The body is the scroller, and the sheet's color is painted down to the keyboard.
  const body = sheet.locator('.surface__body');
  expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
  const sheetBottom = opened.y + opened.height;
  const strip = (y: number) => page.screenshot({ clip: { x: 8, y, width: 374, height: 12 } });
  expect((await strip(sheetBottom + 40)).equals(await strip(sheetBottom + 40 + 150))).toBe(true);

  await page.evaluate(() => (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard(0));
  await expect.poll(async () => Math.abs(((await sheet.boundingBox())?.y ?? 0) - closed.y)).toBeLessThanOrEqual(tolerance);
});
