const BUILD_ID = /^[0-9a-f]{16}$/;
/** The build ID the server put in this page, or `null` (a dev server leaves the placeholder). */
export function pageBuildId(doc: Document = document): string | null {
  const content = doc.querySelector('meta[name="agboard-build"]')?.getAttribute('content') ?? '';
  return BUILD_ID.test(content) ? content : null;
}

/** The build ID in a `ready` event's data, or `null` when there is none. */
export function readyBuildId(event: Event): string | null {
  const data = (event as MessageEvent).data;
  if (typeof data !== 'string') return null;
  try {
    const build = (JSON.parse(data) as { build?: unknown }).build;
    return typeof build === 'string' && BUILD_ID.test(build) ? build : null;
  } catch {
    return null;
  }
}
