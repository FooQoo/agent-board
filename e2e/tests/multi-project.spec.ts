import { expectHistoryNote } from '../helpers/history';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import {
  agboardCatalogOk,
  agboardOk,
  listTasks,
  makeHome,
  nextTaskId,
  projectId,
  removeHome,
  removeProject,
  resetAlphaBeta,
  startServe,
  statesPort,
  stopServe,
  agboardBinary,
  type Serve,
} from '../helpers/agboard';
import { spawn, spawnSync } from 'node:child_process';
import { openManualCreateDialog } from '../helpers/ui';

// Several projects in one data area, shown by one serve. The CLI, the shared files, the HTTP server and
// the browser are real. The browser's requests are touched only where a test needs a slow or failing
// answer for one request. Every test names its project; the page URL (`?project=<ID>`) is what the screen
// shows. This spec owns port 7632 and its own data directory, like states.spec.ts.

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: `http://127.0.0.1:${statesPort}/` });

const synced = (page: Page) => page.getByRole('contentinfo').getByRole('status');
const lane = (page: Page, name: string) => page.getByRole('region', { name });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
/** The inline answer form for a pending card; its accessible labels follow the selected language. */
const request = (page: Page, id: number) => page.locator(`.card__answer[data-task-id="${id}"]`);
/**
 * The project switcher, the first button in the header. An open menu or dialog hides the page behind it
 * from the accessibility tree, so it is found by CSS, which works in every state.
 */
const switcher = (page: Page) => page.locator('header .project-switcher');
const switcherBehindDialog = switcher;
const menuItem = (page: Page, name: string) => page.getByRole('menuitemradio', { name, exact: true });
const projectParam = (page: Page) => new URL(page.url()).searchParams.get('project');

async function choose(page: Page, name: string): Promise<void> {
  await switcher(page).click();
  await menuItem(page, name).click();
}

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}`);
  await expect(synced(page)).toHaveText(/^(Synced|同期済み)/);
}

/** Moves the card with a real drag to the target lane; the reason dialog opens. */
async function dragTaskTo(page: Page, id: number, laneName: string): Promise<Locator> {
  const source = await task(page, id).boundingBox();
  const target = await lane(page, laneName).boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // dnd-kit keeps the source in a dropping animation briefly after the pointer is released.
  const dragged = page.locator('.card').filter({ hasText: new RegExp(`^#${id}(?!\\d)`) }).first();
  await expect(dragged).not.toHaveClass(/card--dragging/);
  return dialog;
}

/** The project's snapshot from the CLI, without the time it was fetched. */
function snapshotOf(project: string, home: string): unknown {
  const result = spawnSync(agboardBinary(), ['--project', project, 'snapshot', '--json'], {
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`snapshot of ${project} failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  delete parsed.fetchedAt;
  return parsed;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

// ------------------------------------------------------------------ A new data area

test.describe('a new data area', () => {
  let home: string;
  let serve: Serve | undefined;

  test.beforeAll(async () => {
    home = makeHome('multi-empty');
    serve = await startServe(statesPort, home);
  });
  test.afterAll(async () => {
    await stopServe(serve);
    removeHome(home);
  });

  test('opens with no projects, and projects created by the CLI appear without a reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('No projects yet')).toBeVisible();
    await expect(page.getByText('Create a project using the CLI.')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText('No projects');
    await expect(switcher(page)).toHaveText('No projects');
    await expect(switcher(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(0);
    await expect(page).toHaveTitle('Agent Board');
    await expect.poll(() => projectParam(page)).toBeNull();

    await page.evaluate(() => {
      (window as unknown as { __opened: boolean }).__opened = true;
    });
    agboardCatalogOk(['project', 'create', 'Alpha'], home);

    // The first project is shown, and the URL names it without adding a history entry.
    await expect(switcher(page)).toHaveText('Alpha');
    await expect(page).toHaveTitle('Alpha - Agent Board');
    await expect(page.getByText('No tasks yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add task' })).toBeEnabled();
    await expect.poll(() => projectParam(page)).toBe(projectId('Alpha', home));
    expect(await page.evaluate(() => (window as unknown as { __opened?: boolean }).__opened)).toBe(true);

    // A project made later is listed, and does not take over the screen.
    agboardCatalogOk(['project', 'create', 'Beta'], home);
    await expect(switcher(page)).toHaveText('Alpha');
    await switcher(page).click();
    await expect(page.getByRole('menu').getByRole('menuitemradio')).toHaveText(['Alpha', 'Beta']);
    await expect(menuItem(page, 'Alpha')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'Beta')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
  });

  test('a same-named project cannot be made', async ({ page }) => {
    const refused = agboardCatalogOk(['project', 'ls', '--json'], home);
    expect(JSON.parse(refused.stdout).projects.map((p: { name: string }) => p.name)).toEqual(['Alpha', 'Beta']);
    const again = spawnSync(agboardBinary(), ['project', 'create', 'Alpha'], {
      env: { ...process.env, AGBOARD_HOME: home },
      encoding: 'utf8',
    });
    expect(again.status).toBe(2);
    expect(again.stderr).toContain('already exists');
    await page.goto('/');
    await expect(switcher(page)).toHaveText('Alpha');
    await switcher(page).click();
    await expect(page.getByRole('menu').getByRole('menuitemradio')).toHaveText(['Alpha', 'Beta']);
  });
});

// ------------------------------------------------------------------ Two projects

test.describe('two projects with the same task numbers', () => {
  let home: string;
  let serve: Serve | undefined;
  let alpha: string;
  let beta: string;

  test.beforeAll(async () => {
    home = makeHome('multi-two');
    serve = await startServe(statesPort, home);
  });
  test.afterAll(async () => {
    await stopServe(serve);
    removeHome(home);
  });
  test.beforeEach(() => {
    resetAlphaBeta(home);
    alpha = projectId('Alpha', home);
    beta = projectId('Beta', home);
  });

  test('task #1 and #2 of each project show their own content, and acting in one never changes the other', async ({
    page,
  }) => {
    await open(page, alpha);
    await expect(page).toHaveTitle('Alpha - Agent Board');
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await expect(task(page, 2)).toHaveText(/Alpha: choose the license/);
    await expect(task(page, 2).locator('..')).toContainText('Which license should Alpha use?');
    await expect(page.getByRole('contentinfo')).toContainText('3 tasks');
    await task(page, 2).click();
    await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Alpha: choose the license');
    await details(page).getByRole('tab', { name: /^History/ }).click();
    await expect(details(page).getByRole('listitem')).toHaveCount(3);

    const betaBefore = snapshotOf('Beta', home);
    const fresh = nextTaskId('Alpha', home);

    // Answer the pending request in Alpha with the board's own dialog.
    const answer = request(page, 2);
    await answer.getByRole('textbox', { name: 'Your answer' }).fill('Use the MIT license.');
    await answer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(answer).toHaveCount(0);
    await expect(task(page, 2)).toContainText('Idle');
    await expect(details(page).getByRole('listitem').first()).toContainText('Use the MIT license.');
    expect(snapshotOf('Beta', home)).toEqual(betaBefore);

    // Create a card in Alpha; it gets the next Alpha number.
    const create = await openManualCreateDialog(page);
    await create.getByRole('textbox', { name: 'Title', exact: true }).fill('Alpha: made on the page');
    await create.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(create).toHaveCount(0);
    await expect(task(page, fresh)).toContainText('Alpha: made on the page');
    expect(snapshotOf('Beta', home)).toEqual(betaBefore);

    // Move #1 with a reason, then archive #3.
    const move = await dragTaskTo(page, 1, 'Doing');
    await move.getByRole('textbox', { name: 'Reason (optional)' }).fill('Starting the notes.');
    await move.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(move).toHaveCount(0);
    await expect(lane(page, 'Doing').getByRole('button', { name: /^#1 User / })).toBeVisible();
    expect(snapshotOf('Beta', home)).toEqual(betaBefore);
    await task(page, 3).click();
    await details(page).getByRole('button', { name: 'Archive task' }).click();
    await details(page).getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(task(page, 3)).toHaveCount(0);
    expect(snapshotOf('Beta', home)).toEqual(betaBefore);
    expect(listTasks('Alpha', home).map(({ id }) => id).sort()).toEqual([1, 2, fresh]);

    // Beta is exactly as it was, including its own #1, #2 and #3.
    await choose(page, 'Beta');
    await expect(switcher(page)).toHaveText('Beta');
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
    await expect(task(page, 2).locator('..')).toContainText('Which database should Beta use?');
    await expect(task(page, 3)).toContainText('Beta: refactor the parser');
    await expect(page.getByRole('contentinfo')).toContainText('3 tasks');
    await expect(page.getByText('Alpha:')).toHaveCount(0);
    await expect(page.getByText('Use the MIT license.')).toHaveCount(0);
    await task(page, 2).click();
    await details(page).getByRole('tab', { name: /^History/ }).click();
    await expect(details(page).getByRole('listitem')).toHaveCount(3);

    // And acting in Beta leaves Alpha as it was.
    const alphaBefore = snapshotOf('Alpha', home);
    const betaAnswer = request(page, 2);
    await betaAnswer.getByRole('textbox', { name: 'Your answer' }).fill('Use plain files.');
    await betaAnswer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(betaAnswer).toHaveCount(0);
    await expect(task(page, 2)).toContainText('Idle');
    expect(snapshotOf('Alpha', home)).toEqual(alphaBefore);
    expect(listTasks('Beta', home).find(({ id }) => id === 2)?.agentStatus).toBe('idle');
  });

  test('changes made to another project do not change what is shown or selected', async ({ page }) => {
    await open(page, alpha);
    await task(page, 2).click();
    await expect(task(page, 2)).toHaveAttribute('aria-current', 'true');

    agboardOk('Beta', ['add', 'Beta: added behind the back'], home);
    agboardOk('Beta', ['mv', '1', 'doing'], home);
    agboardOk('Beta', ['edit', '1', '--title', 'Beta: renamed task'], home);
    agboardCatalogOk(['project', 'create', 'Gamma'], home);
    // The menu hears about the new project, which proves the page received the notifications.
    await switcher(page).click();
    await expect(page.getByRole('menu').getByRole('menuitemradio')).toHaveText(['Alpha', 'Beta', 'Gamma']);
    await page.keyboard.press('Escape');

    await expect(switcher(page)).toHaveText('Alpha');
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await expect(page.getByRole('contentinfo')).toContainText('3 tasks');
    await expect(task(page, 2)).toHaveAttribute('aria-current', 'true');
    await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Alpha: choose the license');
    await expect(page.getByText('Beta:')).toHaveCount(0);

    // A change to the shown project still arrives live.
    agboardOk('Alpha', ['edit', '1', '--title', 'Alpha: edited from the CLI'], home);
    await expect(task(page, 1)).toContainText('Alpha: edited from the CLI');
  });

  test('the menu switches projects: the selection clears, the check and left edge line up, and the keyboard works', async ({
    page,
  }) => {
    await open(page, alpha);
    await task(page, 2).click();
    await expect(details(page).getByRole('heading', { level: 2 })).toBeVisible();

    await switcher(page).click();
    const menu = page.getByRole('menu', { name: 'Alpha' });
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Projects');
    const trigger = (await switcher(page).boundingBox())!;
    const box = (await menu.boundingBox())!;
    // The menu's left edge is the button's left edge, and it opens right under it.
    expect(Math.abs(box.x - trigger.x)).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
    expect(box.y - (trigger.y + trigger.height)).toBeLessThanOrEqual(8);
    // Only the current project carries the check.
    await expect(menuItem(page, 'Alpha')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'Alpha').locator('svg')).toBeVisible();
    await expect(menuItem(page, 'Beta')).toHaveAttribute('aria-checked', 'false');
    await expect(menuItem(page, 'Beta').locator('svg')).toHaveCount(0);

    await menuItem(page, 'Beta').click();
    await expect(menu).toHaveCount(0);
    await expect(switcher(page)).toHaveText('Beta');
    await expect(page).toHaveTitle('Beta - Agent Board');
    await expect.poll(() => projectParam(page)).toBe(beta);
    await expect(details(page)).toContainText('Select a task to see its details.');
    await expect(details(page).getByRole('heading', { level: 2 })).toHaveCount(0);
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
    await expect(page.locator('.card[aria-current="true"]')).toHaveCount(0);
    await switcher(page).click();
    await expect(menuItem(page, 'Beta')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'Alpha')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    // Choosing the project that is already shown changes nothing.
    await task(page, 2).click();
    await choose(page, 'Beta');
    await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Beta: pick the database');

    // Keyboard: Enter opens the menu with the focus on its first item (not on the checked one); arrows,
    // Home and End move; Escape closes and gives the focus back to the button.
    await switcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(menuItem(page, 'Alpha')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menuItem(page, 'Beta')).toBeFocused();
    // The list does not wrap: ArrowDown on the last item stays there.
    await page.keyboard.press('ArrowDown');
    await expect(menuItem(page, 'Beta')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menuItem(page, 'Alpha')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menuItem(page, 'Alpha')).toBeFocused();
    await page.keyboard.press('End');
    await expect(menuItem(page, 'Beta')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(menuItem(page, 'Alpha')).toBeFocused();
    await page.keyboard.press('End');
    await expect(menuItem(page, 'Beta')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(switcher(page)).toBeFocused();
    await expect.poll(() => projectParam(page)).toBe(beta);

    // ArrowDown on the button opens the menu too; Enter chooses the focused project.
    await page.keyboard.press('ArrowDown');
    await expect(menuItem(page, 'Alpha')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(switcher(page)).toHaveText('Alpha');
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await expect(switcher(page)).toBeFocused();

    // Typeahead jumps to the project whose name starts with the typed letter.
    await page.keyboard.press('Enter');
    await page.keyboard.press('b');
    await expect(menuItem(page, 'Beta')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(switcher(page)).toHaveText('Beta');
    await expect.poll(() => projectParam(page)).toBe(beta);
    // Tab leaves the menu closed and moves on.
    await page.keyboard.press('Tab');
    // The header order is project, Add card, Archive, Settings.
    await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeFocused();
  });

  for (const kind of ['create', 'move', 'answer', 'delete'] as const) {
    test(`while a ${kind} form is open the menu is disabled, and it works again when the form is done`, async ({
      page,
    }) => {
      await open(page, alpha);
      let close: () => Promise<void>;
      if (kind === 'create') {
        const dialog = await openManualCreateDialog(page);
        close = async () => {
          await dialog.getByRole('button', { name: 'Cancel' }).click();
        };
      } else if (kind === 'move') {
        const dialog = await dragTaskTo(page, 1, 'Doing');
        close = async () => {
          await dialog.getByRole('button', { name: 'Cancel' }).click();
        };
      } else if (kind === 'answer') {
        await task(page, 2).click();
        const dialog = request(page, 2);
        // Typed text holds the project in place; Cancel clears it and frees the menu.
        await dialog.getByRole('textbox', { name: 'Your answer' }).fill('Typed in the form.');
        close = async () => {
          await dialog.getByRole('button', { name: 'Cancel' }).click();
        };
      } else {
        await task(page, 3).click();
        await details(page).getByRole('button', { name: 'Archive task' }).click();
        const confirm = details(page).getByRole('group', { name: /^Archive #3 / });
        await expect(confirm).toBeVisible();
        close = async () => {
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        };
      }
      await expect(switcherBehindDialog(page)).toBeDisabled();
      await close();
      await expect(switcher(page)).toBeEnabled();
      await choose(page, 'Beta');
      await expect(switcher(page)).toHaveText('Beta');
      await expect.poll(() => projectParam(page)).toBe(beta);
    });
  }

  test('back and forward during a form are applied after it is done, and the form writes to the project it started in', async ({
    page,
  }) => {
    await open(page, alpha);
    await choose(page, 'Beta');
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
    const alphaBefore = snapshotOf('Alpha', home);
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(new URL(request.url()).pathname);
    });
    const fresh = nextTaskId('Beta', home);

    const create = await openManualCreateDialog(page);
    await create.getByRole('textbox', { name: 'Title', exact: true }).fill('Typed in Beta');
    // The browser walks the history back and forth several times while the form is open.
    await page.goBack();
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await page.goForward();
    await expect.poll(() => projectParam(page)).toBe(beta);
    await page.goBack();
    await expect.poll(() => projectParam(page)).toBe(alpha);
    // The form stays, with what was typed, on the project it was opened in.
    await expect(create).toBeVisible();
    await expect(create.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Typed in Beta');
    await expect(switcherBehindDialog(page)).toHaveText('Beta');
    await expect(switcherBehindDialog(page)).toBeDisabled();

    await create.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(create).toHaveCount(0);
    // Done: the latest URL (Alpha) is shown now.
    await expect(switcher(page)).toHaveText('Alpha');
    await expect(page).toHaveTitle('Alpha - Agent Board');
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    expect(posts).toEqual([`/api/projects/${beta}/tasks`]);
    expect(listTasks('Beta', home).map(({ id, title }) => [id, title])).toContainEqual([fresh, 'Typed in Beta']);
    expect(snapshotOf('Alpha', home)).toEqual(alphaBefore);

    // The history was not changed by the form: forward returns to Beta, back to Alpha again.
    await page.goForward();
    await expect(switcher(page)).toHaveText('Beta');
    await expect(task(page, fresh)).toContainText('Typed in Beta');
    await page.goBack();
    await expect(switcher(page)).toHaveText('Alpha');
  });

  test('cancelling a form applies the latest URL; a move and an answer also write to where they started', async ({
    page,
  }) => {
    await open(page, alpha);
    await choose(page, 'Beta');
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);

    // Cancel: the form closes and the screen follows the URL (Alpha).
    const create = await openManualCreateDialog(page);
    await create.getByRole('textbox', { name: 'Title', exact: true }).fill('Never saved');
    await page.goBack();
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await expect(switcherBehindDialog(page)).toHaveText('Beta');
    // The typed title is unsaved, so the question comes first; discarding closes the form.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard and close' }).click();
    await expect(create).toHaveCount(0);
    await expect(switcher(page)).toHaveText('Alpha');
    expect(listTasks('Beta', home).map(({ title }) => title)).not.toContain('Never saved');
    expect(listTasks('Alpha', home).map(({ title }) => title)).not.toContain('Never saved');

    // A move opened in Beta, with the URL moved back to Alpha meanwhile, moves Beta's card #1.
    await page.goForward();
    await expect(switcher(page)).toHaveText('Beta');
    const alphaBefore = snapshotOf('Alpha', home);
    const move = await dragTaskTo(page, 1, 'Doing');
    await page.goBack();
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await move.getByRole('textbox', { name: 'Reason (optional)' }).fill('Beta moves its #1.');
    await move.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(move).toHaveCount(0);
    await expect(switcher(page)).toHaveText('Alpha');
    expect(listTasks('Beta', home).find(({ id }) => id === 1)?.taskStatus).toBe('doing');
    expect(listTasks('Alpha', home).find(({ id }) => id === 1)?.taskStatus).toBe('todo');
    expect(snapshotOf('Alpha', home)).toEqual(alphaBefore);

    // An answer opened in Beta goes to Beta's request, never to Alpha's card #2.
    await page.goForward();
    await expect(switcher(page)).toHaveText('Beta');
    await task(page, 2).click();
    const answer = request(page, 2);
    await answer.getByRole('textbox', { name: 'Your answer' }).fill('Beta answer.');
    await page.goBack();
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await expect(switcher(page)).toHaveText('Beta');
    await expect(answer.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Beta answer.');
    await expect(answer.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    const answerResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/projects/${beta}/tasks/2/answer`),
    );
    await answer.getByRole('button', { name: 'Send', exact: true }).click();
    expect((await answerResponse).status()).toBe(200);
    await expect(switcher(page)).toHaveText('Alpha');
    // Alpha has its own pending #2, so an ID-only locator now resolves to Alpha's answer form.
    await expect(request(page, 2)).toBeVisible();
    expect(listTasks('Beta', home).find(({ id }) => id === 2)?.agentStatus).toBe('idle');
    expect(listTasks('Alpha', home).find(({ id }) => id === 2)?.agentStatus).toBe('pending');
    expect(snapshotOf('Alpha', home)).toEqual(alphaBefore);
  });

  test('a failed save keeps the input and the project; while saving the menu stays disabled', async ({ page }) => {
    await open(page, alpha);
    await choose(page, 'Beta');
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
    let mode: 'fail' | 'hold' | 'pass' = 'fail';
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/projects/*/tasks', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (mode === 'fail') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { reason: 'The storage is busy.' } }),
        });
      }
      if (mode === 'hold') await held;
      return route.fallback();
    });

    const create = await openManualCreateDialog(page);
    await create.getByRole('textbox', { name: 'Title', exact: true }).fill('Kept title');
    await create.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(create.getByRole('alert')).toContainText('Could not save. Your input is kept. Try again.');
    await expect(create.getByRole('alert')).not.toContainText('The storage is busy.');
    // Failure: the input is kept, the form stays on Beta, and the menu stays disabled.
    await expect(create.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Kept title');
    await expect(switcherBehindDialog(page)).toHaveText('Beta');
    await expect(switcherBehindDialog(page)).toBeDisabled();
    expect(listTasks('Beta', home).map(({ title }) => title)).not.toContain('Kept title');

    // Saving: the answer is slow; during it the URL changes and the form cannot be left.
    mode = 'hold';
    const fresh = nextTaskId('Beta', home);
    await create.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(create.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await expect(switcherBehindDialog(page)).toBeDisabled();
    await page.goBack();
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await expect(switcherBehindDialog(page)).toHaveText('Beta');
    release();
    await expect(create).toHaveCount(0);
    // The save went to Beta; the screen then follows the URL to Alpha, which did not get the card.
    await expect(switcher(page)).toHaveText('Alpha');
    await expect(page.getByText('Kept title')).toHaveCount(0);
    expect(listTasks('Beta', home).map(({ id, title }) => [id, title])).toContainEqual([fresh, 'Kept title']);
    expect(listTasks('Alpha', home).map(({ title }) => title)).not.toContain('Kept title');
    mode = 'pass';
  });

  test('a slow answer for a project that is no longer wanted never replaces the board that is shown', async ({
    page,
  }) => {
    await open(page, alpha);
    const boardPath = (id: string) => `**/api/projects/${id}/board`;

    // Alpha -> Beta -> Alpha: Beta's board is slow; Alpha is shown again before it arrives.
    let betaCalls = 0;
    await page.route(boardPath(beta), async (route) => {
      betaCalls += 1;
      await delay(2000);
      await route.continue();
    });
    await choose(page, 'Beta');
    await expect.poll(() => betaCalls).toBeGreaterThan(0);
    await choose(page, 'Alpha');
    await expect(switcher(page)).toHaveText('Alpha');
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await delay(2600);
    await expect(switcher(page)).toHaveText('Alpha');
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await expect(page.getByText('Beta: benchmark the importer')).toHaveCount(0);
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await page.unroute(boardPath(beta));

    // Beta -> Alpha -> Beta with Alpha slow: the older Alpha answer arrives after Beta is shown again.
    await choose(page, 'Beta');
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
    let alphaCalls = 0;
    await page.route(boardPath(alpha), async (route) => {
      alphaCalls += 1;
      await delay(2000);
      await route.continue();
    });
    await choose(page, 'Alpha');
    await expect.poll(() => alphaCalls).toBeGreaterThan(0);
    await choose(page, 'Beta');
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
    await delay(2600);
    await expect(switcher(page)).toHaveText('Beta');
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
    await expect(page.getByText('Alpha: draft the release notes')).toHaveCount(0);
    await expect(page.getByRole('contentinfo')).toContainText('3 tasks');
    await expect.poll(() => projectParam(page)).toBe(beta);
  });

  test('a person answers on the page; the waiting agent gets the answer, and its hook shows only that project progress', async ({
    page,
  }) => {
    const env = { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' };
    const snapshot = JSON.parse(
      spawnSync(agboardBinary(), ['--project', 'Alpha', 'snapshot', '--json'], { env, encoding: 'utf8' }).stdout,
    ) as { cursor: string };

    // The agent waits on Alpha from the cursor it holds.
    const waiter = spawn(agboardBinary(), ['--project', 'Alpha', '--json', 'wait', '--after', snapshot.cursor, '--timeout', '60'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    waiter.stdout.on('data', (chunk) => (out += chunk));
    const ended = new Promise<number | null>((resolve) => waiter.once('exit', (code) => resolve(code)));
    try {
      await delay(500);
      // Another project changes: the wait goes on.
      agboardOk('Beta', ['edit', '1', '--title', 'Beta: edited while Alpha waits'], home);
      await delay(1500);
      expect(waiter.exitCode).toBeNull();

      // The person answers the request of Alpha's card #2 on the page.
      await open(page, alpha);
      await task(page, 2).click();
      const answer = request(page, 2);
      await answer.getByRole('textbox', { name: 'Your answer' }).fill('Use the MIT license, please.');
      await answer.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(answer).toHaveCount(0);

      expect(await ended).toBe(0);
      const received = JSON.parse(out) as {
        project: { id: string; name: string };
        tasks: { id: number; agentStatus: string; history: { at: string; reason: string }[] }[];
      };
      expect(received.project).toMatchObject({ id: alpha, name: 'Alpha' });
      const answered = received.tasks.find(({ id }) => id === 2)!;
      expect(answered.agentStatus).toBe('idle');
      expectHistoryNote(answered.history.at(-1), ['Which license should Alpha use?', 'Use the MIT license, please.']);
      expect(out).not.toContain('Beta');
    } finally {
      waiter.kill();
    }

    // The agent resumes; the hook hands over active progress for Alpha only, while answer history stays with wait.
    agboardOk('Alpha', ['state', '2', 'running', '--actor', 'ai', '--reason', 'Resuming with the MIT license.'], home);
    const hook = spawnSync(agboardBinary(), ['--project', 'Alpha', 'hook', '--agent', 'claude'], {
      env,
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'PostToolUse' }),
    });
    expect(hook.status).toBe(0);
    const context = (JSON.parse(hook.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
      .additionalContext;
    expect(context.startsWith('AGBOARD_PROGRESS\n')).toBe(true);
    expect(context).toContain('Alpha: choose the license');
    expect(context).not.toContain('Beta');
    expect(context).not.toContain('Use the MIT license, please.');
    expect(context).not.toContain('Resuming with the MIT license.');
    await expect(task(page, 2)).toContainText('Running');
  });

  test('the URL names the project: reload, back and forward reproduce it, tabs are independent, a rename keeps it', async ({
    page,
    context,
  }) => {
    // The first visit shows the first project and replaces the history entry instead of adding one.
    await page.goto('/');
    await expect(switcher(page)).toHaveText('Alpha');
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
    await page.goForward();
    await expect(switcher(page)).toHaveText('Alpha');

    await choose(page, 'Beta');
    await expect(switcher(page)).toHaveText('Beta');
    await task(page, 2).click();
    await page.reload();
    await expect(synced(page)).toHaveText(/^Synced/);
    await expect(switcher(page)).toHaveText('Beta');
    await expect.poll(() => projectParam(page)).toBe(beta);
    // A reload does not keep the card selection of the board.
    await expect(details(page)).toContainText('Select a task to see its details.');

    await page.goBack();
    await expect(switcher(page)).toHaveText('Alpha');
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await page.goForward();
    await expect(switcher(page)).toHaveText('Beta');
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);

    // Two tabs of the same browser show different projects, with their own selections.
    const other = await context.newPage();
    other.on('pageerror', (error) => pageErrors.push(error.message));
    await open(other, alpha);
    await expect(switcher(other)).toHaveText('Alpha');
    await task(other, 2).click();
    await task(page, 3).click();
    await expect(details(other).getByRole('heading', { level: 2 })).toHaveText('Alpha: choose the license');
    await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Beta: refactor the parser');
    await choose(other, 'Beta');
    await expect(switcher(other)).toHaveText('Beta');
    // The first tab did not follow, and the second tab's URL is its own.
    await expect(switcher(page)).toHaveText('Beta');
    await choose(page, 'Alpha');
    await expect(switcher(page)).toHaveText('Alpha');
    await expect(switcher(other)).toHaveText('Beta');
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await expect.poll(() => projectParam(other)).toBe(beta);

    // A rename: the tab that shows Alpha by its ID keeps showing the same project under the new name.
    agboardOk('Alpha', ['project', 'rename', 'Alpha Renamed'], home);
    await expect(switcher(page)).toHaveText('Alpha Renamed');
    await expect(page).toHaveTitle('Alpha Renamed - Agent Board');
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await page.reload();
    await expect(switcher(page)).toHaveText('Alpha Renamed');
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await switcher(page).click();
    await expect(page.getByRole('menu').getByRole('menuitemradio')).toHaveText(['Alpha Renamed', 'Beta']);
    await page.keyboard.press('Escape');
    await expect.poll(() => projectParam(page)).toBe(alpha);
    await other.close();
  });

  test('a board that cannot be loaded, a list that cannot be loaded, a deleted project and a bad URL can all be recovered from', async ({
    page,
  }) => {
    // The board of Beta fails: an explanation with Retry, and another project can be chosen.
    await open(page, alpha);
    let failing = true;
    await page.route(`**/api/projects/${beta}/board`, async (route) => {
      if (failing) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"x"}}' });
      return route.fallback();
    });
    await choose(page, 'Beta');
    await expect(page.getByText('Could not load this board.')).toBeVisible();
    await expect(page.getByText('Try again, or switch to another project.')).toBeVisible();
    await expect(switcher(page)).toHaveText('Beta');
    await expect(page.getByRole('contentinfo')).toContainText('Not synced');
    await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(0);
    // Retry while it still fails shows the same state; after it works, Retry loads the board.
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Could not load this board.')).toBeVisible();
    failing = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
    await expect(page.getByText('Could not load this board.')).toHaveCount(0);
    await expect.poll(() => projectParam(page)).toBe(beta);

    // Failing again, switching to the other project recovers without a retry.
    failing = true;
    await page.reload();
    await expect(page.getByText('Could not load this board.')).toBeVisible();
    await choose(page, 'Alpha');
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await page.unroute(`**/api/projects/${beta}/board`);

    // The list of projects cannot be loaded: Retry fetches it again.
    let listFails = true;
    await page.route('**/api/projects', async (route) => {
      if (listFails) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"x"}}' });
      return route.fallback();
    });
    await page.goto(`/?project=${alpha}`);
    await expect(page.getByText('Could not load the board.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(0);
    listFails = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await page.unroute('**/api/projects');

    // The project shown is deleted: it is said so, nothing else is shown instead, and another can be chosen.
    await choose(page, 'Beta');
    await expect(switcher(page)).toHaveText('Beta');
    removeProject('Beta', home);
    await expect(page.getByText('Project not found')).toBeVisible();
    await expect(page.getByText('It was deleted, or the URL is invalid. Choose another project from the menu.')).toBeVisible();
    await expect(switcher(page)).toHaveText('Choose a project');
    await expect(page.getByRole('contentinfo')).toContainText('No project selected');
    await expect.poll(() => projectParam(page)).toBe(beta);
    await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(0);
    await expect(task(page, 1)).toHaveCount(0);
    await switcher(page).click();
    await expect(page.getByRole('menu').getByRole('menuitemradio')).toHaveText(['Alpha']);
    await expect(page.getByRole('menuitemradio', { checked: true })).toHaveCount(0);
    await menuItem(page, 'Alpha').click();
    await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    await expect.poll(() => projectParam(page)).toBe(alpha);

    // A bad ID and an ID nobody has are not found either, and are not replaced by another project.
    for (const bad of ['not-an-id', '00000000000000000000000000000000', beta]) {
      await page.goto(`/?project=${bad}`);
      await expect(page.getByText('Project not found')).toBeVisible();
      await expect.poll(() => projectParam(page)).toBe(bad);
      await expect(task(page, 1)).toHaveCount(0);
      await choose(page, 'Alpha');
      await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
    }

    // The last project is deleted: there are no projects, and a new one is shown when it is made.
    removeProject('Alpha', home);
    await expect(page.getByText('No projects yet')).toBeVisible();
    await expect(switcher(page)).toHaveText('No projects');
    await expect(switcher(page)).toBeDisabled();
    // A project made afterwards is offered, but the screen does not move to it by itself: the URL still
    // names the project that was deleted.
    agboardCatalogOk(['project', 'create', 'Fresh'], home);
    await expect(page.getByText('Project not found')).toBeVisible();
    await expect(switcher(page)).toHaveText('Choose a project');
    await expect(switcher(page)).toBeEnabled();
    await choose(page, 'Fresh');
    await expect(switcher(page)).toHaveText('Fresh');
    await expect(page.getByText('No tasks yet.')).toBeVisible();
    await expect.poll(() => projectParam(page)).toBe(projectId('Fresh', home));
  });

  test('existing screens work in every project: Japanese and the detail width', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem('agboard.locale')) localStorage.setItem('agboard.locale', 'ja');
      } catch {
        // storage is not available
      }
    });
    await open(page, alpha);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.getByRole('button', { name: 'タスク追加' })).toBeVisible();
    await expect(lane(page, '進行中')).toBeVisible();
    await switcher(page).click();
    await expect(page.getByRole('menu', { name: 'Alpha' })).toContainText('プロジェクト');
    await menuItem(page, 'Beta').click();
    await expect(switcher(page)).toHaveText('Beta');
    await expect(lane(page, '進行中').getByRole('button', { name: /^#2 AI 待機中 Beta: pick the database / })).toBeVisible();
    // The answer, in Japanese and typed in place, for Beta's own request.
    await task(page, 2).click();
    const japanesePanel = page.getByRole('complementary', { name: 'タスクの詳細' });
    // The answer form is part of the request, open at once; no dialog opens.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const japaneseAnswer = request(page, 2);
    await expect(japaneseAnswer.getByRole('textbox', { name: '回答' })).toBeVisible();
    await japaneseAnswer.getByRole('textbox', { name: '回答' }).fill('Typed then cleared.');
    await japaneseAnswer.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(japaneseAnswer.getByRole('textbox', { name: '回答' })).toHaveValue('');

    // The detail width a person chose belongs to the screen, not to the project.
    const panel = page.getByRole('complementary', { name: 'タスクの詳細' });
    const before = (await panel.boundingBox())!;
    const handle = page.getByRole('separator', { name: 'タスクの詳細の幅を変更' });
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 60, hb.y + hb.height / 2, { steps: 6 });
    await page.mouse.up();
    const widened = (await panel.boundingBox())!;
    expect(widened.width).toBeGreaterThan(before.width + 20);
    await choose(page, 'Alpha');
    await expect(switcher(page)).toHaveText('Alpha');
    await expect(task(page, 1)).toBeVisible();
    expect(Math.abs((await panel.boundingBox())!.width - widened.width)).toBeLessThanOrEqual(1);
    await page.reload();
    await expect(synced(page)).toHaveText(/^同期済み/);
    expect(Math.abs((await panel.boundingBox())!.width - widened.width)).toBeLessThanOrEqual(1);
  });

  test('every one of the 24 themes shows both projects and keeps the menu usable', async ({ page }) => {
    const accents = ['blue', 'sky', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange', 'red', 'pink', 'purple', 'gray'];
    await open(page, alpha);
    for (const mode of ['dark', 'light']) {
      for (const accent of accents) {
        await page.evaluate(
          ([m, a]) => localStorage.setItem('agboard.theme', JSON.stringify({ mode: m, accent: a })),
          [mode, accent],
        );
        await page.reload();
        await expect(synced(page)).toHaveText(/^Synced/);
        const root = page.locator('html');
        await expect(root).toHaveAttribute('data-mode', mode);
        await expect(root).toHaveAttribute('data-accent', accent);
        // The menu and the board of both projects are readable in the theme.
        await switcher(page).click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        const menuBackground = await menu.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(menuBackground).not.toBe('rgba(0, 0, 0, 0)');
        await menuItem(page, 'Beta').click();
        await expect(task(page, 1)).toHaveText(/Beta: benchmark the importer/);
        await expect(root).toHaveAttribute('data-accent', accent);
        await choose(page, 'Alpha');
        await expect(task(page, 1)).toHaveText(/Alpha: draft the release notes/);
        await expect(root).toHaveAttribute('data-mode', mode);
      }
    }
  });
});

// ------------------------------------------------------------------ Long names and many projects

test.describe('long names and many projects', () => {
  let home: string;
  let serve: Serve | undefined;
  const longName = 'The quarterly planning board of the platform teams'; // 50 characters
  const many = Array.from({ length: 100 }, (_, index) => `Project ${String(index + 1).padStart(3, '0')}`);

  test.beforeAll(async () => {
    expect(longName).toHaveLength(50);
    home = makeHome('multi-many');
    agboardCatalogOk(['project', 'create', longName], home);
    for (const name of many) agboardCatalogOk(['project', 'create', name], home);
    agboardOk(longName, ['add', 'A task in the long project', '--desc', 'x'], home);
    agboardOk(many[41], ['add', 'A task in project 042'], home);
    serve = await startServe(statesPort, home);
  });
  test.afterAll(async () => {
    await stopServe(serve);
    removeHome(home);
  });

  async function headerFits(page: Page): Promise<void> {
    const width = page.viewportSize()!.width;
    const parts = [
      switcher(page),
      page.getByRole('button', { name: 'Add task' }),
      page.getByRole('button', { name: 'Settings' }),
    ];
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    for (const part of parts) {
      await expect(part).toBeVisible();
      boxes.push((await part.boundingBox())!);
    }
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      expect(box.width).toBeGreaterThan(24);
      expect(box.height).toBeGreaterThan(20);
    }
    // In order, without overlapping one another.
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width - 0.5);
    }
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      header: (() => {
        const header = document.querySelector('header')!;
        return header.scrollWidth - header.clientWidth;
      })(),
    }));
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.header).toBeLessThanOrEqual(0);
  }

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    test(`${viewport.width}px: a 50-character name and 100 projects keep the header whole and the menu reachable`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const longId = projectId(longName, home);
      await open(page, longId);
      // The name is cut visually only: the button keeps the whole name for readers and as a tooltip.
      await expect(page.getByRole('banner').getByRole('button', { name: longName })).toBeVisible();
      const button = switcher(page);
      await expect(button).toHaveAttribute('title', longName);
      await headerFits(page);
      // The whole name is shown on a desktop screen (cut only when the header runs out of room), and it is
      // not the whole header either.
      const nameBox = (await button.boundingBox())!;
      expect(nameBox.width).toBeGreaterThan(200);
      expect(nameBox.width).toBeLessThan(viewport.width / 2);
      await expect(page.getByRole('contentinfo')).toContainText('1 task');

      // The menu with 101 items stays inside the screen, is one scrolling list, and its edge is the button's.
      await button.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitemradio')).toHaveCount(101);
      const trigger = (await button.boundingBox())!;
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
      expect(Math.abs(box.x - trigger.x)).toBeLessThanOrEqual(1);
      expect(await menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      // The long name is whole in its item's accessible name. Names sort in code-point order, so the
      // long name ("The ...") is last and "Project 001" first.
      await expect(menuItem(page, longName)).toHaveAttribute('aria-checked', 'true');
      await expect(menu.getByRole('menuitemradio').last()).toHaveAccessibleName(longName);

      // Keyboard: End reaches the last project, Home the first; the focused item is always on screen.
      // The pointer is parked outside the menu, so that it does not take the focus from the keys.
      await page.mouse.move(viewport.width - 4, viewport.height - 4);
      await page.keyboard.press('End');
      await expect(menuItem(page, longName)).toBeFocused();
      await expect(menuItem(page, longName)).toBeInViewport();
      await page.keyboard.press('Home');
      await expect(menuItem(page, 'Project 001')).toBeFocused();
      await expect(menuItem(page, 'Project 001')).toBeInViewport();
      // Thirty arrow presses at the pace of a held key (presses with no gap at all are merged by the menu).
      for (let step = 0; step < 30; step += 1) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(15);
      }
      await expect(menuItem(page, 'Project 031')).toBeFocused();
      await expect(menuItem(page, 'Project 031')).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();

      // Typeahead and Enter choose a project far down the list; the header stays whole with a short name.
      await page.keyboard.press('Enter');
      for (const key of 'Project 042') await page.keyboard.press(key === ' ' ? 'Space' : key);
      await expect(menuItem(page, 'Project 042')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(switcher(page)).toHaveText('Project 042');
      await expect(task(page, 1)).toHaveText(/A task in project 042/);
      await expect.poll(() => projectParam(page)).toBe(projectId('Project 042', home));
      await headerFits(page);

      // Choosing the long-named project again by the mouse: its card shows and the header is whole.
      await switcher(page).click();
      await menuItem(page, longName).scrollIntoViewIfNeeded();
      await menuItem(page, longName).click();
      await expect(task(page, 1)).toHaveText(/A task in the long project/);
      await headerFits(page);
    });
  }

  test('in Japanese the header controls fit with the 50-character name as well', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('agboard.locale', 'ja'));
    await page.setViewportSize({ width: 1024, height: 768 });
    await open(page, projectId(longName, home));
    await expect(page.getByRole('button', { name: 'タスク追加' })).toBeVisible();
    await expect(page.getByRole('button', { name: '設定' })).toBeVisible();
    const width = 1024;
    for (const name of ['タスク追加', '設定']) {
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
