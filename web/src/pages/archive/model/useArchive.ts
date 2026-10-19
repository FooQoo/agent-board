import { fetchArchive, type ArchiveResponse } from '../../../features/tasks/api/read';
import { useProjectResource } from '../../../features/projects/model/useProjectResource';
import type { ProjectId } from '../../../shared/api/contracts';

/** Archive counterpart to useBoard; keeps retrieval state and project race handling in one place. */
export function useArchive(projectId: ProjectId | null) {
  return useProjectResource<ArchiveResponse>(projectId, fetchArchive);
}
