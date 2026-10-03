import { expect, test } from '@playwright/test';
import { listCards, resetBoard } from '../helpers/skan';

test.beforeEach(() => {
  resetBoard();
});

test('a delete request without the token or an Origin is refused and the card stays', async ({
  request,
}) => {
  const before = listCards();
  const response = await request.delete('/api/cards/15');
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('forbidden');
  expect(listCards()).toEqual(before);
});

test('a token alone, a bad token, or a wrong Origin is not enough', async ({ page, request }) => {
  await page.goto('/');
  const token = await page.locator('meta[name="skan-token"]').getAttribute('content');
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  const before = listCards();

  // The right token, but the request does not come from the page.
  const tokenOnly = await request.delete('/api/cards/15', { headers: { 'X-Skan-Token': token! } });
  expect(tokenOnly.status()).toBe(403);

  // The page's origin, but no token.
  const originOnly = await request.delete('/api/cards/15', {
    headers: { Origin: 'http://127.0.0.1:7631', 'Sec-Fetch-Site': 'same-origin' },
  });
  expect(originOnly.status()).toBe(403);

  // The page's origin and a wrong token.
  const wrongToken = await request.delete('/api/cards/15', {
    headers: {
      Origin: 'http://127.0.0.1:7631',
      'Sec-Fetch-Site': 'same-origin',
      'X-Skan-Token': '0'.repeat(64),
    },
  });
  expect(wrongToken.status()).toBe(403);

  // The right token from another site's origin.
  const otherOrigin = await request.delete('/api/cards/15', {
    headers: {
      Origin: 'http://example.com',
      'Sec-Fetch-Site': 'cross-site',
      'X-Skan-Token': token!,
    },
  });
  expect(otherOrigin.status()).toBe(403);

  expect(listCards()).toEqual(before);
});

test('the token appears only in the page, never in the API responses', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="skan-token"]').getAttribute('content'))!;
  for (const path of ['/api/board', '/api/health']) {
    expect(await (await request.get(path)).text()).not.toContain(token);
  }
});
