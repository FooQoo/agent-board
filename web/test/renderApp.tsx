import { render } from '@testing-library/react';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { vi } from 'vitest';
import { App, type AppProps } from '../src/App';

/**
 * Renders the app inside the nuqs testing adapter with an in-memory URL. `navigate` replaces the URL from
 * outside the app, the way the browser's back and forward buttons do; `updates` lists what the app wrote.
 */
export function renderApp(search = '', props: AppProps = {}) {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
  const tree = (searchParams: string) => (
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
      <App {...props} />
    </NuqsTestingAdapter>
  );
  const view = render(tree(search));
  return {
    ...view,
    updates: () => onUrlUpdate.mock.calls.map(([event]) => event),
    navigate: (next: string) => view.rerender(tree(next)),
  };
}
