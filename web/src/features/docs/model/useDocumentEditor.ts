import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '@/shared/api/contracts';
import { splitFrontmatter } from '@/shared/markdown/frontmatter';
import { useSaveFlow } from '@/shared/ui/editor/useSaveFlow';
import {
  DocsWriteError,
  fetchDocsFile,
  saveDocsFile,
  saveErrorMessage,
  type DocsFile,
} from '../api/docsApi';

export interface UseDocumentEditorOptions {
  projectId: ProjectId;
  /** The loaded file; a different object starts the edit over. */
  file: DocsFile;
  /** A save went through. */
  onSaved?: () => void;
  onSavingChange?: (saving: boolean) => void;
}

/**
 * The edit of one loaded file: the body is split from the front matter, a change is known only
 * once the editor reports one, and a save writes the original front matter back above the edited
 * body against the revision last read or saved. The edit survives a failed save or a conflict.
 */
export function useDocumentEditor({
  projectId,
  file,
  onSaved,
  onSavingChange,
}: UseDocumentEditorOptions) {
  const { t } = useTranslation();
  const split = useMemo(() => splitFrontmatter(file.content), [file]);
  // What the file holds as body now (the loaded text, then the last saved), and the text the
  // editor reported since; null while the editor has reported nothing.
  const [saved, setSaved] = useState(split.body);
  const [edited, setEdited] = useState<string | null>(null);
  const [revision, setRevision] = useState(file.revision);
  const [conflict, setConflict] = useState<{ currentRevision: string | null } | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  useEffect(() => {
    setSaved(split.body);
    setEdited(null);
    setRevision(file.revision);
    setConflict(null);
    setRejection(null);
  }, [file, split]);

  const flow = useSaveFlow({ onClose: () => {}, closeOnSuccess: false, onSavingChange });

  const dirty = edited !== null && edited !== saved;
  const canSave = dirty && !file.readOnly && !flow.saving;

  const onChange = useCallback((value: string) => setEdited(value), []);

  const write = useCallback(
    async (expectedRevision: string) => {
      if (edited === null) return;
      const result = await saveDocsFile(projectId, {
        path: file.path,
        content: split.frontmatter + edited,
        expectedRevision,
      });
      setSaved(edited);
      setRevision(result.revision);
      setConflict(null);
      onSaved?.();
    },
    [edited, projectId, file.path, split.frontmatter, onSaved],
  );

  const attempt = useCallback(
    (expectedRevision: () => Promise<string>) =>
      flow.run(async () => {
        setRejection(null);
        try {
          await write(await expectedRevision());
        } catch (cause) {
          if (cause instanceof DocsWriteError && cause.conflict) {
            setConflict({ currentRevision: cause.currentRevision });
            return;
          }
          const message = saveErrorMessage(t, cause);
          if (message === null) throw cause;
          setRejection(message);
        }
      }),
    [flow.run, write, t],
  );

  const save = useCallback(async () => {
    if (!canSave) return;
    await attempt(async () => revision);
  }, [canSave, attempt, revision]);

  /** Saves over the latest file: against the revision the conflict named, or the one read now. */
  const overwrite = useCallback(async () => {
    if (conflict === null || file.readOnly) return;
    await attempt(
      async () => conflict.currentRevision ?? (await fetchDocsFile(projectId, file.path)).revision,
    );
  }, [conflict, file.readOnly, file.path, attempt, projectId]);

  return {
    frontmatter: split.frontmatter,
    body: split.body,
    dirty,
    canSave,
    onChange,
    save,
    overwrite,
    saving: flow.saving,
    error: rejection ?? flow.error,
    conflict: conflict !== null,
  };
}
