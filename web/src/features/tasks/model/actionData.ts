import type { AcceptanceItem, Assignee } from '../../../shared/api/contracts';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';

export interface ActionDialogData {
  requestId?: string;
  title?: string;
  /** The whole TASK.md or EPIC.md text, frontmatter included (a file that cannot be read is edited this way). */
  description?: string;
  /** The body without its frontmatter, saved with `acceptance`. */
  body?: string;
  acceptance?: AcceptanceItem[];
  assignee?: Assignee;
  reason?: string;
  /** Create: the card is made a draft once it is added. */
  isDraft?: boolean;
  /** Edit only: hand the card back to the agents in the same step. */
  finalize?: boolean;
  attachments?: EditorAttachment[];
  removedAttachmentIds?: string[];
  requestKind?: 'simple';
  epicId?: string | null;
}
