import type { AppProps } from './App';

/**
 * Initial UI state for the sample-data mode (`vite --mode mock`), read from the page URL:
 * `?select=<id>`, `?confirm=1`, `?deleteFail=1`. `main.tsx` only calls this when `import.meta.env.MODE`
 * is `mock`, so the production build neither reads these parameters nor contains this code.
 */
export function readMockInitial(search: string): NonNullable<AppProps['initial']> {
  const params = new URLSearchParams(search);
  const select = Number(params.get('select'));
  return {
    select: Number.isInteger(select) && select > 0 ? select : undefined,
    confirm: params.get('confirm') === '1',
    deleteFail: params.get('deleteFail') === '1',
  };
}
