import { expect, test } from '@playwright/test';
import { agboardOk, listCards, mainOrigin, mainPort, mainProject, projectId, resetBoard, cardBody, type CardJson } from '../helpers/agboard';

// Writes go to /api/projects/<ProjectId>/cards/<number>; the guard answers before it looks at the project.
let card15: string;

test.beforeEach(() => {
  resetBoard(mainProject);
  card15 = `/api/projects/${projectId(mainProject)}/cards/15`;
});

test('a delete request without the token or an Origin is refused and the card stays', async ({
  request,
}) => {
  const before = listCards(mainProject);
  const response = await request.delete(card15);
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('forbidden');
  expect(listCards(mainProject)).toEqual(before);
});

test('a token alone, a bad token, or a wrong Origin is not enough', async ({ page, request }) => {
  await page.goto('/');
  const token = await page.locator('meta[name="agboard-token"]').getAttribute('content');
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  const before = listCards(mainProject);

  // The right token, but the request does not come from the page.
  const tokenOnly = await request.delete(card15, { headers: { 'X-Agboard-Token': token! } });
  expect(tokenOnly.status()).toBe(403);

  // The page's origin, but no token.
  const originOnly = await request.delete(card15, {
    headers: { Origin: mainOrigin, 'Sec-Fetch-Site': 'same-origin' },
  });
  expect(originOnly.status()).toBe(403);

  // The page's origin and a wrong token.
  const wrongToken = await request.delete(card15, {
    headers: {
      Origin: mainOrigin,
      'Sec-Fetch-Site': 'same-origin',
      'X-Agboard-Token': '0'.repeat(64),
    },
  });
  expect(wrongToken.status()).toBe(403);

  // The right token from another site's origin.
  const otherOrigin = await request.delete(card15, {
    headers: {
      Origin: 'http://example.com',
      'Sec-Fetch-Site': 'cross-site',
      'X-Agboard-Token': token!,
    },
  });
  expect(otherOrigin.status()).toBe(403);

  expect(listCards(mainProject)).toEqual(before);
});

test('the token appears only in the page, never in the API responses', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="agboard-token"]').getAttribute('content'))!;
  for (const path of ['/api/projects', `/api/projects/${projectId(mainProject)}/board`, '/api/health']) {
    expect(await (await request.get(path)).text()).not.toContain(token);
  }
});

// ------------------------------------------------------------------ Edit and draft writes


interface Shown extends CardJson {
  description: string;
  isDraft: boolean;
}
const shown = (id: number): Shown => JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;

/** The page's own request: its Origin, Sec-Fetch-Site, and token, as the screen sends them. */
async function fromPage(
  page: import('@playwright/test').Page,
  method: string,
  path: string,
  body: unknown,
  token: string | null = null,
): Promise<{ status: number; body: { error?: { code: string }; card?: Shown } }> {
  return page.evaluate(
    async ({ method, path, body, token }) => {
      const meta = document.querySelector('meta[name="agboard-token"]')?.getAttribute('content') ?? '';
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Agboard-Token': token ?? meta },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    },
    { method, path, body, token },
  );
}

test('the edit and the draft switch are refused without the guard, and nothing changes', async ({ page, request }) => {
  const card13 = `/api/projects/${projectId(mainProject)}/cards/13`;
  await page.goto('/');
  const token = (await page.locator('meta[name="agboard-token"]').getAttribute('content'))!;
  const before = listCards(mainProject);
  const draftBefore = shown(13).isDraft;

  for (const [method, url, data] of [
    ['PUT', `${card13}/draft`, { isDraft: true }],
    ['PATCH', card13, { title: 'Hijacked' }],
  ] as const) {
    const send = (headers: Record<string, string>) => request.fetch(url, { method, data, headers });
    // Nothing at all, the token only, an Origin only, a wrong token, and a foreign Origin with the right token.
    const attempts: Record<string, string>[] = [
      {},
      { 'X-Agboard-Token': token },
      { Origin: mainOrigin, 'Sec-Fetch-Site': 'same-origin' },
      { Origin: mainOrigin, 'Sec-Fetch-Site': 'same-origin', 'X-Agboard-Token': '0'.repeat(64) },
      { Origin: 'http://example.com', 'Sec-Fetch-Site': 'cross-site', 'X-Agboard-Token': token },
      { Origin: mainOrigin, 'Sec-Fetch-Site': 'cross-site', 'X-Agboard-Token': token },
      { Origin: mainOrigin, 'Sec-Fetch-Site': 'same-origin', 'X-Agboard-Token': token, Host: `evil.example:${mainPort}` },
    ];
    for (const headers of attempts) {
      const response = await send(headers);
      expect(response.status(), `${method} ${JSON.stringify(Object.keys(headers))}`).toBe(403);
    }
  }
  expect(listCards(mainProject)).toEqual(before);
  expect(shown(13).isDraft).toBe(draftBefore);
});

test('with the guard, a draft switch and an edit follow the card rules; a bad body or an oversize one changes nothing', async ({
  page,
}) => {
  await page.goto('/');
  const base = `/api/projects/${projectId(mainProject)}/cards`;

  // A running card is refused; a Pending card can be drafted without answering it.
  for (const running of [11]) {
    const refused = await fromPage(page, 'PUT', `${base}/${running}/draft`, { isDraft: true });
    expect(refused.status, `#${running}`).toBe(409);
    expect(refused.body.error?.code, `#${running}`).toBe('invalid_state_for_draft');
    expect(shown(running).isDraft).toBe(false);
  }
  const pendingBefore = shown(12);
  expect((await fromPage(page, 'PUT', `${base}/12/draft`, { isDraft: true })).status).toBe(200);
  expect(shown(12)).toMatchObject({ isDraft: true, agentStatus: 'pending', pendingRequestId: pendingBefore.pendingRequestId, pendingReason: pendingBefore.pendingReason });
  // An edit of a card that is not a draft is refused.
  const notDraft = await fromPage(page, 'PATCH', `${base}/13`, { description: 'Not allowed' });
  expect(notDraft.status).toBe(409);
  expect(notDraft.body.error?.code).toBe('card_not_draft');
  expect(shown(13).description).toContain('Check the layout at 1280, 800, and 480 px.\nLook for horizontal scrolling.');

  // A draft takes an edit; CRLF becomes LF; finalize hands it back in the same step.
  expect((await fromPage(page, 'PUT', `${base}/13/draft`, { isDraft: true })).status).toBe(200);
  const edited = await fromPage(page, 'PATCH', `${base}/13`, { description: cardBody('one\r\ntwo') });
  expect(edited.status).toBe(200);
  expect(shown(13).description).toContain('one\ntwo');
  expect(shown(13).isDraft).toBe(true);

  // Too long: refused with the reason, and the stored text is the previous one. An empty title and an empty edit too.
  const tooLong = await fromPage(page, 'PATCH', `${base}/13`, { description: 'あ'.repeat(50_001) });
  expect(tooLong.status).toBe(422);
  expect(shown(13).description).toContain('one\ntwo');
  expect((await fromPage(page, 'PATCH', `${base}/13`, { title: '' })).status).toBeGreaterThanOrEqual(400);
  expect((await fromPage(page, 'PATCH', `${base}/13`, {})).status).toBeGreaterThanOrEqual(400);
  expect(shown(13).description).toContain('one\ntwo');
  expect(shown(13)).toMatchObject({ title: 'Check the board display', isDraft: true });
  // A body over 1 MiB is refused before it is read in full.
  const huge = await fromPage(page, 'PATCH', `${base}/13`, { description: 'x'.repeat(1_200_000) });
  expect(huge.status).toBe(413);
  expect(shown(13).description).toContain('one\ntwo');

  const finalized = await fromPage(page, 'PATCH', `${base}/13`, { title: 'Final title', finalize: true });
  expect(finalized.status).toBe(200);
  expect(shown(13)).toMatchObject({ title: 'Final title', isDraft: false });
  expect(shown(13).description).toContain('one\ntwo');
  // It is no longer a draft, so the next edit is refused.
  expect((await fromPage(page, 'PATCH', `${base}/13`, { title: 'Again' })).status).toBe(409);
});
