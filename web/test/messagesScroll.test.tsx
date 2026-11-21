import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagesSurface } from '../src/features/tasks/messages/MessagesSurface';
import {
  SAMPLE_PROJECT,
  sampleMessages,
  sampleMessagesApi,
} from '../src/features/tasks/messages/messageSamples';
import { selectLocale } from '../src/shared/i18n';

beforeEach(() => selectLocale('en'));
afterEach(cleanup);

function setup(kind: 'dialog' | 'sheet') {
  const messages = sampleMessages('en');
  render(
    <MessagesSurface
      projectId={SAMPLE_PROJECT}
      messages={messages}
      kind={kind}
      target={{}}
      api={sampleMessagesApi('en')}
      onChanged={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const body = () => {
    const element = document.querySelector<HTMLElement>('.surface__body');
    if (!element) throw new Error('The surface body is missing.');
    return element;
  };
  return { body, title: messages[1]?.title ?? '' };
}

// The body is one scroller shared by the list and the opened message: it must start at the top
// each time the screen switches between them.
describe.each(['dialog', 'sheet'] as const)('MessagesSurface scroll (%s)', (kind) => {
  it('returns to the top after answering a question', async () => {
    const { body, title } = setup(kind);
    body().scrollTop = 200;
    fireEvent.click(await screen.findByText(title));
    const [choice] = await screen.findAllByRole('radio');
    if (!choice) throw new Error('The question has no option.');
    fireEvent.click(choice);
    body().scrollTop = 300;
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(body().scrollTop).toBe(0);
  });

  it('returns to the top after going back to the list', async () => {
    const { body, title } = setup(kind);
    fireEvent.click(await screen.findByText(title));
    await screen.findAllByRole('radio');
    body().scrollTop = 300;
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(body().scrollTop).toBe(0);
  });
});
