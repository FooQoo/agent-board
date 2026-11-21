import type { Page } from '@playwright/test';

export interface ArchiveRead {
  limit: number;
  cursor: string | null;
}

/**
 * Answers the archive reads of `page` with `total` synthetic archived tasks, `#total` down to `#1`, newest
 * first, a page at a time like the server does (the cursor is the index of the next row). The server's own
 * paging is covered by the Rust tests; this drives the screens' loading. With `failAt`, the read that
 * starts at that index fails once, so a retry can be shown. Returns the reads made so far.
 */
export async function stubArchivePages(
  page: Page,
  { total, failAt }: { total: number; failAt?: number },
): Promise<ArchiveRead[]> {
  const reads: ArchiveRead[] = [];
  let failed = false;
  await page.route('**/api/projects/*/archive?*', async (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get('limit'));
    const cursor = url.searchParams.get('cursor');
    reads.push({ limit, cursor });
    const start = cursor === null ? 0 : Number(cursor);
    if (failAt !== undefined && start === failAt && !failed) {
      failed = true;
      await route.fulfill({
        status: 500,
        json: { error: { code: 'database_error', message: 'The archive could not be read.', reason: 'Try again.' } },
      });
      return;
    }
    // The Summary has a whole card to copy, and the project the page is on.
    const summary = await (await route.fetch({ url: url.href.replace(/\/archive\?.*$/, '/summary') })).json();
    const template = summary.tasks[0];
    const end = Math.min(total, start + limit);
    const tasks = Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      const archivedAt = new Date(Date.UTC(2026, 9, 1, 12) - index * 60_000).toISOString();
      return {
        ...template,
        id: total - index,
        title: `Paged archive task ${total - index}`,
        taskStatus: 'done',
        archivedAt,
        attachments: [],
        acceptance: [],
      };
    });
    await route.fulfill({
      json: {
        project: summary.project,
        version: summary.version,
        tasks,
        epics: [],
        total,
        nextCursor: end < total ? String(end) : null,
      },
    });
  });
  return reads;
}
