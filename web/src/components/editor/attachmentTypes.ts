/** Metadata returned by the card attachment API. */
export interface StoredAttachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt?: string;
}

/** An attachment shown by the editor. `url` is owned by the state hook. */
export interface EditorAttachment extends StoredAttachment {
  url: string;
  source: 'stored' | 'local';
  file?: File;
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
