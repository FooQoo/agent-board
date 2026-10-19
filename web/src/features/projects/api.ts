import type { ProjectList } from '../../shared/api/contracts';
import { getJson } from '../../shared/api/http';

export function fetchProjects(): Promise<ProjectList> {
  return getJson<ProjectList>('/api/projects');
}
