import { mainHome, mainOrigin, mainProject, projectId } from './agboard';

/** The write token the server puts in the page it serves. */
async function pageToken(origin: string): Promise<string> {
  const html = await (await fetch(`${origin}/`)).text();
  const token = html.match(/<meta name="agboard-token" content="([^"]*)"/)?.[1];
  if (!token) throw new Error(`no write token in the page at ${origin}`);
  return token;
}

/**
 * Makes a card a draft (or takes the draft back) the way the preview dialog does: `PUT /tasks/{id}/draft`
 * with the page's token and same-origin headers. A spec that needs a draft to start from calls this; the
 * page no longer has a button for it.
 */
export async function putDraft(
  id: number,
  isDraft = true,
  options: { discard?: boolean; project?: string; origin?: string; home?: string } = {},
): Promise<void> {
  const origin = options.origin ?? mainOrigin;
  const project = options.project ?? mainProject;
  const response = await fetch(`${origin}/api/projects/${projectId(project, options.home ?? mainHome())}/tasks/${id}/draft`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'X-Agboard-Token': await pageToken(origin),
    },
    body: JSON.stringify({ isDraft, ...(options.discard ? { discard: true } : {}) }),
  });
  if (!response.ok) throw new Error(`PUT draft answered ${response.status}: ${await response.text()}`);
}
