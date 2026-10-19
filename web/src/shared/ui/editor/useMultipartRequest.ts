import { useRef } from 'react';

/** Reuse a write identity after a lost response; changed input is a new operation. */
export function useMultipartRequest() {
  const last = useRef<{ fingerprint: string; id: string } | null>(null);
  return (input: unknown): string => {
    const fingerprint = JSON.stringify(input);
    if (last.current?.fingerprint !== fingerprint)
      last.current = { fingerprint, id: crypto.randomUUID() };
    return last.current.id;
  };
}
