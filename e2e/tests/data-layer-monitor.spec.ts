import { expect, test, type Page } from '@playwright/test';
import { agboard, removeProject, taskBody } from '../helpers/agboard';
import {
  createMonitorHome,
  monitorProjectId,
  removeMonitorHome,
  startPhoneEntrance,
  type PhoneEntrance,
} from '../helpers/monitor';

// The phone monitor reads one project: `/monitor/?project={projectId}` is required, the Summary is
// the only thing read for the list, and a Detail is read when a person opens it and not before.
// It goes through the same entrance as the phone's: the passcode first, then the data.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 375, height: 812 }, locale: 'en-US', timezoneId: 'UTC' });

let home: string;
let alpha: string;
let beta: string;
let entrance: PhoneEntrance;

const url = (project: string) => `${entrance.phoneOrigin}/monitor/?project=${project}`;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = createMonitorHome();
  alpha = monitorProjectId(home, 'Alpha');
  beta = monitorProjectId(home, 'Beta');
  entrance = await startPhoneEntrance(home);
});

test.afterAll(async () => {
  await entrance?.stop();
  if (home) removeMonitorHome(home);
});

interface Seen {
  at: number;
  path: string;
  query: string;
}

/** Every request the page makes to the monitor's API, in order. */
function watch(page: Page): Seen[] {
  const seen: Seen[] = [];
  page.on('request', (request) => {
    const parsed = new URL(request.url());
    if (parsed.pathname.startsWith('/monitor/api/'))
      seen.push({ at: Date.now(), path: parsed.pathname, query: parsed.search });
  });
  return seen;
}

const summaries = (seen: Seen[], project?: string) =>
  seen.filter((r) => r.path.endsWith('/summary') && (project === undefined || r.path.includes(project)));
const details = (seen: Seen[]) => seen.filter((r) => r.path.includes('/detail'));
/** Requests that name a project, by that project's ID. */
const projectsNamed = (seen: Seen[]) => [
  ...new Set(
    seen.flatMap((r) => {
      const fromPath = /\/monitor\/api\/projects\/([^/]+)/.exec(r.path)?.[1];
      const fromQuery = new URLSearchParams(r.query).get('project');
      return [fromPath, fromQuery].filter((id): id is string => id !== undefined && id !== null);
    }),
  ),
];

test.describe('one project, named in the address', () => {
  test('reads the Summary of the project in the address only, with no other project and no switcher', async ({ page }) => {
    const seen = watch(page);
    await entrance.open(page, url(alpha));
    await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
    await expect(page.getByRole('article', { name: /Beta pending review/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'All Projects' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();

    expect(summaries(seen, alpha).length).toBeGreaterThanOrEqual(1);
    expect(projectsNamed(seen)).toEqual([alpha]);
    // The project list and the whole board are not read, and neither is any Detail.
    expect(seen.filter((r) => r.path === '/monitor/api/projects' || r.path.endsWith('/board'))).toEqual([]);
    expect(seen.filter((r) => r.path.endsWith('/epics'))).toEqual([]);
    expect(details(seen)).toEqual([]);
    // The events follow only that project.
    const events = seen.filter((r) => r.path === '/monitor/api/events');
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) expect(new URLSearchParams(event.query).get('project')).toBe(alpha);

    // The other project, asked for in the same way, shows its own cards and none of Alpha's.
    const other = await page.context().newPage();
    await other.goto(url(beta));
    await expect(other.getByRole('article', { name: /Beta pending review/ })).toBeVisible();
    await expect(other.getByRole('article', { name: /Alpha pending review/ })).toHaveCount(0);
    await other.close();
  });

  test('an address without a project, or with one that is not a project, is an error and asks for no data', async ({ page }) => {
    const seen = watch(page);
    for (const query of ['', '?project=', '?project=all', `?project=${alpha.toUpperCase()}`, `?project=${alpha}0`, `?project=${alpha}&project=${beta}`, `?other=${alpha}`]) {
      await page.goto(`${entrance.phoneOrigin}/monitor/${query}`);
      await expect(page.getByRole('alert')).toContainText(/This link (has no project|is not valid)/);
      // The way back is the QR code on the PC, not a list of projects.
      await expect(page.getByRole('alert')).toContainText('scan the QR code again');
      await expect(page.getByRole('article')).toHaveCount(0);
      await expect(page.getByLabel('Passcode')).toHaveCount(0);
    }
    // Not even the session or the passcode was asked for.
    expect(seen).toEqual([]);
  });

  test('a project that does not exist, or was deleted, is an error and shows no other project', async ({ page }) => {
    const gone = monitorProjectId(home, 'DeleteMe');
    const seen = watch(page);
    await entrance.open(page, url('f'.repeat(32)));
    await expect(page.getByRole('alert')).toContainText('This project is no longer available');
    await expect(page.getByRole('alert')).toContainText('scan the QR code again');
    await expect(page.getByRole('article')).toHaveCount(0);
    expect(projectsNamed(seen)).toEqual(['f'.repeat(32)]);
    expect(seen.filter((r) => r.path === '/monitor/api/projects' || r.path.endsWith('/board'))).toEqual([]);

    // A project deleted after the page was opened ends the same way.
    const live = await page.context().newPage();
    await live.goto(url(gone));
    await expect(live.getByRole('region', { name: 'Work summary' })).toBeVisible();
    removeProject('DeleteMe', home);
    await live.getByRole('button', { name: 'Refresh' }).click();
    await expect(live.getByRole('alert')).toContainText('This project is no longer available');
    await expect(live.getByRole('region', { name: 'Work summary' })).toHaveCount(0);
    await live.close();
  });

  test('asks for no project data before the passcode, and keeps the project through the passcode and a new one', async ({ page }) => {
    const seen = watch(page);
    await page.goto(url(alpha));
    await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();
    expect(seen.filter((r) => r.path !== '/monitor/api/session')).toEqual([]);

    await entrance.unlockPage(page);
    await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('project')).toBe(alpha);
    expect(projectsNamed(seen)).toEqual([alpha]);

    // The tunnel is replaced: the next read is refused and the passcode is asked for again.
    await entrance.rotate();
    seen.length = 0;
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('project')).toBe(alpha);
    await entrance.unlockPage(page);
    await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('project')).toBe(alpha);
    expect(projectsNamed(seen)).toEqual([alpha]);
    expect(summaries(seen, alpha).length).toBeGreaterThanOrEqual(1);
  });
});

test.describe('a Detail is read when it is opened, once', () => {
  test('reads no Detail until a card is opened, then each section once, and not again for a tab already seen', async ({ page }) => {
    const seen = watch(page);
    await entrance.open(page, url(alpha));
    await expect(page.getByRole('article', { name: /Alpha running two/ })).toBeVisible();
    await page.waitForTimeout(500);
    expect(details(seen)).toEqual([]);

    // A change to a card nobody opened updates the list and reads no Detail.
    const before = summaries(seen).length;
    agboard('Alpha', ['edit', '3', '--desc', taskBody('Changed while nobody looked.'), '--json'], home);
    await expect.poll(() => summaries(seen).length, { timeout: 15_000 }).toBeGreaterThan(before);
    await page.waitForTimeout(500);
    expect(details(seen)).toEqual([]);

    // Opening the card shows the frame at once and reads the body, once.
    await page.getByRole('button', { name: 'Alpha running two' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Alpha running two' })).toBeVisible();
    await expect(dialog.getByText('Changed while nobody looked.')).toBeVisible();
    expect(details(seen).map((r) => `${r.path.split('/projects/')[1]}${r.query}`)).toEqual([
      `${alpha}/tasks/3/detail?sections=document`,
    ]);

    // The history is read when its tab is reached; going back and forth reads nothing more.
    await dialog.getByRole('tab', { name: /History/ }).click();
    await expect(dialog.getByText('Start work')).toBeVisible();
    expect(details(seen)).toHaveLength(2);
    expect(details(seen)[1]?.query).toBe('?sections=history');
    await dialog.getByRole('tab', { name: 'Body' }).click();
    await expect(dialog.getByText('Changed while nobody looked.')).toBeVisible();
    await dialog.getByRole('tab', { name: /History/ }).click();
    await dialog.getByRole('tab', { name: 'Body' }).click();
    await page.waitForTimeout(300);
    expect(details(seen)).toHaveLength(2);

    // Closing and opening the same card again reuses what was read.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Alpha running two' }).click();
    await expect(page.getByRole('dialog').getByText('Changed while nobody looked.')).toBeVisible();
    expect(details(seen)).toHaveLength(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a lane change reads the list again but not the body; the history change shows when opened', async ({ page }) => {
    const seen = watch(page);
    await entrance.open(page, url(alpha));
    await page.getByRole('button', { name: 'Alpha running one' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Running task one.')).toBeVisible();
    await dialog.getByRole('tab', { name: /History/ }).click();
    await expect(dialog.getByText('Working now')).toBeVisible();
    const documentReads = () => details(seen).filter((r) => r.query === '?sections=document').length;
    expect(documentReads()).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // The hold lasts three seconds after the drawer closes.
    await page.waitForTimeout(3300);

    const before = summaries(seen).length;
    agboard('Alpha', ['mv', '2', 'done', '--actor', 'ai', '--reason', 'Finished from the test'], home);
    await expect.poll(() => summaries(seen).length, { timeout: 15_000 }).toBeGreaterThan(before);
    await expect(page.getByRole('region', { name: 'Work summary' })).toBeVisible();
    await page.waitForTimeout(800);
    expect(documentReads()).toBe(1);

    await page.getByRole('button', { name: 'Alpha running one' }).click();
    await page.getByRole('dialog').getByRole('tab', { name: /History/ }).click();
    await expect(page.getByRole('dialog').getByText('Finished from the test')).toBeVisible();
    expect(documentReads()).toBe(1);
    await page.keyboard.press('Escape');
  });

  test('holds automatic updates while the drawer is open and for three seconds after, but not a manual refresh', async ({ page }) => {
    const seen = watch(page);
    await entrance.open(page, url(alpha));
    await page.getByRole('button', { name: 'Alpha ordinary todo' }).click();
    await expect(page.getByRole('dialog').getByText('An ordinary task that has not started.')).toBeVisible();
    await page.waitForTimeout(300);

    const before = summaries(seen).length;
    agboard('Alpha', ['mv', '3', 'done', '--actor', 'ai', '--reason', 'Held back'], home);
    await page.waitForTimeout(2500);
    expect(summaries(seen).length).toBe(before);

    const closedAt = Date.now();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => summaries(seen).length, { timeout: 12_000 }).toBeGreaterThan(before);
    const applied = summaries(seen)[before];
    expect((applied?.at ?? 0) - closedAt).toBeGreaterThanOrEqual(2500);

    // Pressing the refresh button inside the hold asks at once.
    await page.getByRole('button', { name: 'Alpha ordinary todo' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const mark = summaries(seen).length;
    const pressedAt = Date.now();
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => summaries(seen).length, { timeout: 2000 }).toBeGreaterThan(mark);
    expect((summaries(seen)[mark]?.at ?? Infinity) - pressedAt).toBeLessThan(2000);
  });
});
