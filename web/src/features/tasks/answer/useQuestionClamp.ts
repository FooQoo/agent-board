import { useLayoutEffect, useRef, useState } from 'react';

/** Measures the existing four-line clamp and follows width changes in board and monitor layouts. */
export function useQuestionClamp(text: string | null, active: boolean) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` changes the measured layout.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || element === null) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, active]);

  return { ref, cut };
}
