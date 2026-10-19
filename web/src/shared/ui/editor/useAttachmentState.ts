import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorAttachment, StoredAttachment } from './attachmentTypes';

export interface UseAttachmentStateOptions {
  initial?: readonly StoredAttachment[];
  /** Resolves a stored attachment to this card's same-project API URL. */
  resolveStoredUrl: (attachment: StoredAttachment) => string;
}

/**
 * Why the last picture was refused. `name` is the file that broke the rule, when one file did; the
 * screen words it. Nothing is added when a notice is set.
 */
export type AttachmentNotice =
  | { kind: 'format'; name: string }
  | { kind: 'tooLarge'; name: string }
  | { kind: 'count' }
  | { kind: 'total' };

export interface AttachmentState {
  attachments: EditorAttachment[];
  addFiles: (files: Iterable<File>) => void;
  remove: (id: string) => void;
  cancel: () => void;
  reset: (attachments: readonly StoredAttachment[]) => void;
  clear: () => void;
  error: AttachmentNotice | null;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_FILE = 10 * 1024 * 1024;
const MAX_COUNT = 20;
const MAX_TOTAL = 50 * 1024 * 1024;

function storedAttachments(
  attachments: readonly StoredAttachment[],
  resolveStoredUrl: (attachment: StoredAttachment) => string,
): EditorAttachment[] {
  return attachments.map((attachment) => ({
    ...attachment,
    url: resolveStoredUrl(attachment),
    source: 'stored',
  }));
}

function localId(): string {
  // A file can be selected more than once; this keeps each draft entry distinct.
  return crypto.randomUUID().replaceAll('-', '');
}

export function useAttachmentState({
  initial = [],
  resolveStoredUrl,
}: UseAttachmentStateOptions): AttachmentState {
  const [attachments, setAttachments] = useState(() =>
    storedAttachments(initial, resolveStoredUrl),
  );
  const [error, setError] = useState<AttachmentNotice | null>(null);
  const currentAttachments = useRef(attachments);
  currentAttachments.current = attachments;
  const urls = useRef(new Set<string>());
  const resolver = useRef(resolveStoredUrl);
  resolver.current = resolveStoredUrl;

  const release = useCallback((url: string) => {
    if (!urls.current.delete(url)) return;
    URL.revokeObjectURL(url);
  }, []);

  const addFiles = useCallback((files: Iterable<File>) => {
    const selected = Array.from(files);
    const current = currentAttachments.current;
    const wrong = selected.find((f) => !IMAGE_TYPES.includes(f.type));
    if (wrong) {
      setError({ kind: 'format', name: wrong.name });
      return;
    }
    const large = selected.find((f) => f.size > MAX_FILE);
    if (large) {
      setError({ kind: 'tooLarge', name: large.name });
      return;
    }
    if (current.length + selected.length > MAX_COUNT) {
      setError({ kind: 'count' });
      return;
    }
    if (
      current.reduce((n, f) => n + f.size, 0) + selected.reduce((n, f) => n + f.size, 0) >
      MAX_TOTAL
    ) {
      setError({ kind: 'total' });
      return;
    }
    setError(null);
    const next = selected.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return {
        id: localId(),
        name: file.name,
        mediaType: file.type,
        size: file.size,
        url,
        source: 'local' as const,
        file,
      };
    });
    if (next.length > 0) {
      currentAttachments.current = [...current, ...next];
      setAttachments(currentAttachments.current);
    }
  }, []);

  const remove = useCallback((id: string) => {
    setError(null);
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const cancel = useCallback(() => {
    setError(null);
    setAttachments((current) => current.filter((a) => a.source === 'stored'));
  }, []);

  const clear = useCallback(() => {
    setError(null);
    setAttachments([]);
  }, []);

  const reset = useCallback((next: readonly StoredAttachment[]) => {
    setError(null);
    setAttachments(storedAttachments(next, resolver.current));
  }, []);

  useEffect(() => {
    const active = new Set(attachments.filter((a) => a.source === 'local').map((a) => a.url));
    for (const url of urls.current) if (!active.has(url)) release(url);
  }, [attachments, release]);

  useEffect(
    () => () => {
      urls.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      urls.current.clear();
    },
    [],
  );

  return { attachments, addFiles, remove, cancel, reset, clear, error };
}
