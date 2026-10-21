// The same save for the screenshot and video scripts (plain Node, no TypeScript).
// `PUT /api/preferences` on the PC entrance, with the page's token and same-origin headers.
export async function setPreferences(origin, patch) {
  const html = await (await fetch(`${origin}/`)).text();
  const token = html.match(/<meta name="agboard-token" content="([^"]*)"/)?.[1];
  if (!token) throw new Error(`no write token in the page at ${origin}`);
  const response = await fetch(`${origin}/api/preferences`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'X-Agboard-Token': token,
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`PUT /api/preferences answered ${response.status}: ${await response.text()}`);
  return response.json();
}
