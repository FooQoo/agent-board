import { useState } from 'react';

const PROJECT_ID = /^[0-9a-f]{32}$/;

/**
 * Which project the monitor shows. The phone opens `/monitor/?project={projectId}`; an address
 * without a valid project is an error screen, never a list of every project.
 */
export type MonitorRoute =
  | { status: 'ok'; projectId: string }
  | { status: 'missing' }
  | { status: 'invalid' };

export function parseMonitorRoute(search: string): MonitorRoute {
  const values = new URLSearchParams(search).getAll('project');
  if (values.length === 0 || (values.length === 1 && values[0] === '')) {
    return { status: 'missing' };
  }
  const [value] = values;
  if (values.length > 1 || value === undefined || !PROJECT_ID.test(value)) {
    return { status: 'invalid' };
  }
  return { status: 'ok', projectId: value };
}

/** The route of this page. The address is read once: the monitor never navigates to another project. */
export function useMonitorUrl(): MonitorRoute {
  const [route] = useState(() => parseMonitorRoute(window.location.search));
  return route;
}
