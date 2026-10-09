import { fetchArchive, type ArchiveResponse } from '../api';
import { useProjectResource } from './useProjectResource';
import type { ProjectId } from '../types';

/** Archive counterpart to useBoard; keeps retrieval state and project race handling in one place. */
export function useArchive(projectId: ProjectId | null) {
  return useProjectResource<ArchiveResponse>(projectId, fetchArchive);
}
