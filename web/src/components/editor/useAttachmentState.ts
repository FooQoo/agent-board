import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorAttachment, StoredAttachment } from './attachmentTypes';

export interface UseAttachmentStateOptions {
  initial?: readonly StoredAttachment[];
  /** Resolves a stored attachment to this card's same-project API URL. */
  resolveStoredUrl: (attachment: StoredAttachment) => string;
}

export interface AttachmentState {
  attachments: EditorAttachment[];
  addFiles: (files: Iterable<File>) => void;
  remove: (id: string) => void;
  cancel: () => void;
  reset: (attachments: readonly StoredAttachment[]) => void;
  clear: () => void;
}

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
  return `local-${crypto.randomUUID()}`;
}

export function useAttachmentState({
  initial = [],
  resolveStoredUrl,
}: UseAttachmentStateOptions): AttachmentState {
  const [attachments, setAttachments] = useState(() =>
    storedAttachments(initial, resolveStoredUrl),
  );
  const urls = useRef(new Set<string>());
  const resolver = useRef(resolveStoredUrl);
  resolver.current = resolveStoredUrl;

  const release = useCallback((url: string) => {
    if (!urls.current.delete(url)) return;
    URL.revokeObjectURL(url);
  }, []);

  const addFiles = useCallback((files: Iterable<File>) => {
    const next = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => {
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
    if (next.length > 0) setAttachments((current) => [...current, ...next]);
  }, []);

  const remove = useCallback(
    (id: string) => {
      setAttachments((current) => {
        const removed = current.find((attachment) => attachment.id === id);
        if (removed?.source === 'local') release(removed.url);
        return current.filter((attachment) => attachment.id !== id);
      });
    },
    [release],
  );

  const cancel = useCallback(() => {
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.source === 'local') release(attachment.url);
      });
      return current.filter((attachment) => attachment.source === 'stored');
    });
  }, [release]);

  const clear = useCallback(() => {
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.source === 'local') release(attachment.url);
      });
      return [];
    });
  }, [release]);

  const reset = useCallback(
    (next: readonly StoredAttachment[]) => {
      setAttachments((current) => {
        current.forEach((attachment) => {
          if (attachment.source === 'local') release(attachment.url);
        });
        return storedAttachments(next, resolver.current);
      });
    },
    [release],
  );

  useEffect(
    () => () => {
      urls.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      urls.current.clear();
    },
    [],
  );

  return { attachments, addFiles, remove, cancel, reset, clear };
}
