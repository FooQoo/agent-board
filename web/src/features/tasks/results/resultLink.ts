/** A ProjectId is 32 lowercase hexadecimal digits. */
function isProjectIdValue(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

/** The result a link points at: a task of the project in the same link, and one version of it. */
export interface ResultLinkTarget {
  /** The project the link names; the task belongs to it. */
  projectId: string;
  taskId: number;
  version: number;
}

/**
 * The query of a result link: `?project=<ProjectId>&task=<id>&result=<version>`. The path is `/`
 * and nothing is kept in a hash, so the page shell and the passcode screen keep the whole query.
 */
export function resultLinkQuery(projectId: string, taskId: number, version: number): string | null {
  if (!isProjectIdValue(projectId) || !isPositiveInteger(taskId) || !isVersion(version))
    return null;
  const params = new URLSearchParams();
  params.set('project', projectId);
  params.set('task', String(taskId));
  params.set('result', String(version));
  return `?${params.toString()}`;
}

/**
 * The address of one result at the public origin of the connection, for a notification to open.
 * Gives nothing for a bad ProjectId, task, or version, or an origin that is not http(s).
 */
export function resultLinkUrl(
  origin: string | null,
  projectId: string,
  taskId: number,
  version: number,
): string | null {
  const query = resultLinkQuery(projectId, taskId, version);
  if (!origin || query === null) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.pathname = '/';
  url.hash = '';
  url.search = query;
  return url.toString();
}

/**
 * The result a page query asks for. `project` must be a ProjectId and both `task` and `result`
 * positive integers; anything
 * else (missing, zero, text, a fraction) is no target, so a damaged link opens the plain board.
 */
export function parseResultTarget(search: string | URLSearchParams): ResultLinkTarget | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const projectId = params.get('project') ?? '';
  const taskId = parsePositiveInteger(params.get('task'), Number.MAX_SAFE_INTEGER);
  const version = parsePositiveInteger(params.get('result'), MAX_VERSION);
  if (!isProjectIdValue(projectId) || taskId === null || version === null) return null;
  return { projectId, taskId, version };
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** A version is a `u32` on the server. */
const MAX_VERSION = 4_294_967_295;

function isVersion(value: number): boolean {
  return isPositiveInteger(value) && value <= MAX_VERSION;
}

/** A decimal positive integer up to `max`. */
function parsePositiveInteger(raw: string | null, max: number): number | null {
  if (raw === null || !/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= max ? value : null;
}
